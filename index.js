const { wire, util } = require('bns')
const { BufferReader } = require('bufio')
const EventEmitter = require('events')
const { Resource } = require('./dns/resource')

class Hip5 extends EventEmitter {
  constructor (protocols, node) {
    super()
    this.ns = node.ns
    this.ns.middle = this._hip5(protocols, this.middleware)
    this.logger = node.logger.context(this.constructor.id)
    this.opened = false
  }

  async open () {
    this.opened = true
    this.emit('open')
  }
  async close () {
    this.opened = false
    this.emit('close')
  }

  // Copy hsd's server.resolve() to lookup a name on HNS normally
  async resolveHNS (req, tld) {
    const [qs] = req.question
    const name = qs.name.toLowerCase()
    const type = qs.type

    // Check the root resolver cache first
    let res = null
    const cache = this.ns.cache.get(name, type)
    if (cache) {
      res = cache
    } else {
      res = await this.ns.response(req)
      // Cache responses
      if (!util.equal(tld, '_synth.')) {
        this.ns.cache.set(name, type, res)
      }
    }
    return res
  }

  // Needed to e.g. grab TXT records
  async resource (tld) {
    if (tld[tld.length - 1] === '.') {
      tld = tld.slice(0, -1)
    }
    const data = await this.ns.lookupName(tld)
    return Resource.decode(data)
  }

  // send SOA-only when we don't have / don't want to answer.
  async sendSOA () {
    const res = new wire.Message()
    res.aa = true
    res.authority.push(this.ns.toSOA())
    this.ns.signRRSet(res.authority, wire.types.SOA)
    return res
  }

  // Convert a wire-format DNS record to a message and send.
  sendData (data, type) {
    const res = new wire.Message()
    res.aa = true
    const br = new BufferReader(data)
    while (br.left() > 0) {
      res.answer.push(wire.Record.read(br))
    }

    // Answers resolved from alternate name systems appear to come directly
    // from the HNS root zone.
    this.ns.signRRSet(res.answer, type)

    if (type !== wire.types.CNAME) {
      this.ns.signRRSet(res.answer, wire.types.CNAME)
    }

    return res
  }

  _hip5 (protocols, handler) {
    if (typeof protocols === 'string') {
      protocols = [protocols]
    }

    const mid = async function middleware (tld, req) {
      const [qs] = req.question
      const name = qs.name.toLowerCase()
      const type = qs.type
      const labels = util.split(name)
      let protocol

      if (protocol = protocols.find(p => tld.indexOf(p) >= 0)) {
        if (typeof this.direct === 'function') {
          const response = protocols.length === 1 ? this.direct(name, type) : this.direct(protocol, name, type)
          if (response) {
            return response
          }
        }
        return await this.sendSOA()
      }

      const res = await this.resolveHNS(req, tld)

      // Look for any supported HIP-5 extension in the NS record
      // and query it for the user's original request.
      let record
      if (res.authority.length) {
        for (const rr of res.authority) {
          if (rr.type !== wire.types.NS) {
            continue
          }
          const ending = util.label(rr.data.ns, util.split(rr.data.ns), -1)
          if (protocol = protocols.find(p => p === ending)) {
            record = rr
            break
          }
        }
      }

      // If there are no NS records, or no matching protocol,
      // the plugin is bypassed.
      if (!protocol) {
        return res
      }

      // If the recursive is being minimal, don't look up the name.
      // Send the SOA back and get the full query from the recursive .
      // if (labels.length < 2) {
      //   return await this.sendSOA()
      // }
      // NOTE: Not relevant to _hyper --- protocol works for TLDs as well.

      const ns = record.data.ns
      this.logger.debug(
        'Intercepted referral to .%s: %s %s -> %s NS: %s',
        protocol,
        name,
        wire.typesByVal[type],
        record.name,
        ns
      )

      let data = ns.slice(0, ns.lastIndexOf('.', ns.length - 2))
      let response
      try {
        response = protocols.length === 1 ?
          await handler.call(this, data, name, type, req, tld, res) : await handler.call(this, protocol, data, name, type, req, tld, res)
      } catch (err) {
        this.logger.warning('Resolution failed for name: %s', name)
        this.logger.debug(err.stack)
      }

      if (!response) {
        // Never send HIP-5 type referrals to recursive resolvers
        // since they aren't real delegations and it could end up
        // poisoning their cache.
        if (protocol) {
          return await this.sendSOA()
        }

        // return the HNS root server response unmodified.
        return res
      }

      // If we did get an answer, mark the response
      // as authoritative and send the new answer.
      this.logger.debug(`Returning response via ${protocol} protocol.`)
      return response
    }

    return mid.bind(this)
  }
}

module.exports = Hip5

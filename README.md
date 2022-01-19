# HIP-5 Class

Base class for writing HIP-5 [`hsd`](https://github.com/handshake-org/hsd) extensions like [handover](https://github.com/lukeburns/handover).

## Example

```js
const Hip5 = require('hip5')

const PROTOCOL = '_example'

class Plugin extends Hip5 {
  constructor (node) {
    super(PROTOCOL, node)
  }

  direct (name, type) {
    // direct resolution
  }

  middleware (keys, name, type) {
    // hip5 referral resolution
  }
}

exports.id = 'example-hip5-protocol'
exports.init = node => new Plugin(node)
```

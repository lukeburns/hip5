# HIP-5 Class

Base class for writing [HIP-5](https://github.com/handshake-org/HIPs/blob/master/HIP-0005.md) extensions like [handover](https://github.com/lukeburns/handover).

## Example

```js
const Hip5 = require('hip5')

const PROTOCOL = '_example'

class Plugin extends Hip5 {
  static id = 'example-hip5-extension'

  constructor (node) {
    super(PROTOCOL, node)
  }

  direct (name, type) {
    // direct resolution
  }

  middleware (data, name, type) {
    // hip5 referral resolution
  }
}

exports.id = Plugin.id
exports.init = node => new Plugin(node)
```

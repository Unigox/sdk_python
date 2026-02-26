# Unigox SDKs

This repository contains helper SDK files for Unigox partner crypto transfer authorization.

## Python

```bash
pip install requests eth-account web3
```

```python
from partner_authorize_crypto_transfer_sdk import authorize_crypto_transfer

result = authorize_crypto_transfer(
    api_url="https://api-snc2e.ondigitalocean.app",
    api_key="<YOUR_PARTNER_API_KEY>",
    order_id="<ORDER_ID>",
    private_key="<PARTNER_WALLET_PRIVATE_KEY>",
)
print(result)
```

## JavaScript

```bash
npm install ethers
```

```javascript
const { authorizeCryptoTransfer } = require('./partner_authorize_crypto_transfer_sdk');

authorizeCryptoTransfer({
  apiUrl: 'https://api-snc2e.ondigitalocean.app',
  apiKey: '<YOUR_PARTNER_API_KEY>',
  orderId: '<ORDER_ID>',
  privateKey: '<PARTNER_WALLET_PRIVATE_KEY>',
})
  .then(console.log)
  .catch(console.error);
```

## Files

- `partner_authorize_crypto_transfer_sdk.py`: canonical Python helper file.
- `partner_authorize_crypto_transfer_sdk.js`: canonical JavaScript helper file.
- `sdk.py`: legacy compatibility alias file.
- `requirements.txt`: runtime Python dependency list.

# Unigox Python SDK

This repository contains the Unigox Python partner SDK for crypto transfer authorization.

The JavaScript SDK is maintained in a separate repository:

- https://github.com/Unigox/sdk_javascript

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

## Files

- `partner_authorize_crypto_transfer_sdk.py`: canonical Python helper file.
- `sdk.py`: legacy compatibility alias file.
- `requirements.txt`: runtime Python dependency list.

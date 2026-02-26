# Unigox Python SDK

This repository currently contains the Unigox partner helper SDK for crypto transfer authorization.

## Install

Install dependencies into your environment:

```bash
pip install requests eth-account web3
```

## Usage

```python
from sdk import authorize_crypto_transfer

result = authorize_crypto_transfer(
    api_url="https://api-snc2e.ondigitalocean.app",
    api_key="<YOUR_PARTNER_API_KEY>",
    order_id="<ORDER_ID>",
    private_key="<PARTNER_WALLET_PRIVATE_KEY>",
)
print(result)
```

## Files

- `sdk.py`: partner crypto transfer authorization flow helper.
- `requirements.txt`: runtime Python dependency list.

## OpenAPI

The API spec references this SDK in the SDK section.

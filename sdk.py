"""
Partner SDK helper for POST /api/v1/partner/orders/{order_id}/authorize-crypto-transfer

Fetches transfer authorization parameters from the API, builds and signs an EIP-712
ForwardRequest, and submits it to authorize the crypto transfer.

Security: Your private key never leaves your machine. It is used locally to sign the
EIP-712 ForwardRequest. Only the signature and unsigned request fields are sent to the API.

Dependencies:
  pip install web3 eth-account requests

Usage:
  python3 partner_authorize_crypto_transfer_sdk.py \
    --api-url http://localhost:8080 \
    --api-key <partner_api_key> \
    --order-id <order_uuid> \
    --private-key <partner_wallet_private_key>
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict

import requests
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3


@dataclass
class TransferAuthorizationParams:
    chain_id: int
    rpc_url: str
    token_address: str
    forwarder_address: str
    recipient_address: str
    sender_address: str
    amount_atomic: str
    transfer_data: str
    forwarder_nonce: str
    recommended_gas_limit: int
    recommended_ttl_seconds: int

    @staticmethod
    def from_api(data: Dict[str, Any]) -> "TransferAuthorizationParams":
        return TransferAuthorizationParams(
            chain_id=int(data["chain_id"]),
            rpc_url=data["rpc_url"],
            token_address=data["token_address"],
            forwarder_address=data["forwarder_address"],
            recipient_address=data["recipient_address"],
            sender_address=data["sender_address"],
            amount_atomic=data["amount_atomic"],
            transfer_data=data["transfer_data"],
            forwarder_nonce=data["forwarder_nonce"],
            recommended_gas_limit=int(data.get("recommended_gas_limit", 500000)),
            recommended_ttl_seconds=int(data.get("recommended_ttl_seconds", 3600)),
        )


def _checksum(web3: Web3, addr: str) -> str:
    return web3.to_checksum_address(addr)


def build_forward_request(
    *,
    private_key: str,
    params: TransferAuthorizationParams,
    deadline: int | None = None,
) -> Dict[str, Any]:
    """Builds unsigned ForwardRequest using server-provided parameters.

    The API provides transfer_data (encoded ERC20 transfer calldata), forwarder_nonce,
    and sender_address so the SDK doesn't need to do any ABI encoding or extra RPC calls.
    """
    web3 = Web3(Web3.HTTPProvider(params.rpc_url))
    acct = Account.from_key(private_key)

    sender = _checksum(web3, params.sender_address)
    token = _checksum(web3, params.token_address)

    # Verify the wallet matches the server-provided sender address.
    if acct.address.lower() != sender.lower():
        raise ValueError(
            f"Private key derives {acct.address} but server expects sender {sender}"
        )

    now = int(time.time())
    dl = deadline if deadline is not None else now + params.recommended_ttl_seconds

    return {
        "from": sender,
        "to": token,
        "value": "0",
        "gas": str(params.recommended_gas_limit),
        "nonce": params.forwarder_nonce,
        "deadline": str(dl),
        "data": params.transfer_data,
    }


def sign_forward_request(
    *,
    private_key: str,
    params: TransferAuthorizationParams,
    forward_request: Dict[str, Any],
) -> str:
    """Signs ForwardRequest with EIP-712 typed data matching the on-chain ERC2771Forwarder.

    Domain and types must match the deployed forwarder contract exactly.
    Verified by calling forwarder.eip712Domain() on-chain.
    """
    web3 = Web3(Web3.HTTPProvider(params.rpc_url))
    forwarder = _checksum(web3, params.forwarder_address)

    domain = {
        "name": "SyntheticAssetForwarder",
        "version": "1",
        "chainId": params.chain_id,
        "verifyingContract": forwarder,
    }

    types = {
        "ForwardRequest": [
            {"name": "from", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "gas", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
            {"name": "deadline", "type": "uint48"},
            {"name": "data", "type": "bytes"},
        ]
    }

    signable = encode_typed_data(domain_data=domain, message_types=types, message_data=forward_request)
    signed = Account.sign_message(signable, private_key=private_key)
    return signed.signature.hex()


def fetch_transfer_authorization_params(
    api_url: str, api_key: str, order_id: str
) -> TransferAuthorizationParams:
    """Fetches transfer authorization parameters from GET /partner/orders/{order_id}/transfer-authorization-parameters."""
    url = f"{api_url}/api/v1/partner/orders/{order_id}/transfer-authorization-parameters"
    resp = requests.get(url, headers={"X-API-Key": api_key}, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise RuntimeError(f"API error: {body.get('error', body)}")
    return TransferAuthorizationParams.from_api(body["data"])


def build_authorize_crypto_transfer_payload(
    *,
    private_key: str,
    params: TransferAuthorizationParams,
    deadline: int | None = None,
) -> Dict[str, Any]:
    """
    Builds and signs the EIP-712 ForwardRequest.
    Returns the request body for POST /authorize-crypto-transfer.
    """
    forward_request = build_forward_request(
        private_key=private_key,
        params=params,
        deadline=deadline,
    )
    signature = sign_forward_request(
        private_key=private_key,
        params=params,
        forward_request=forward_request,
    )
    return {"forward_request": forward_request, "signature": signature}


def submit_authorize_crypto_transfer(
    api_url: str, api_key: str, order_id: str, payload: Dict[str, Any]
) -> Dict[str, Any]:
    """Submits the signed payload to POST /partner/orders/{order_id}/authorize-crypto-transfer."""
    url = f"{api_url}/api/v1/partner/orders/{order_id}/authorize-crypto-transfer"
    resp = requests.post(url, headers={"X-API-Key": api_key, "Content-Type": "application/json"}, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()


def authorize_crypto_transfer(
    *,
    api_url: str,
    api_key: str,
    order_id: str,
    private_key: str,
) -> Dict[str, Any]:
    """
    End-to-end: fetches parameters, builds and signs the ForwardRequest, submits it.
    Returns the API response from authorize-crypto-transfer.
    """
    print(f"[1/3] Fetching transfer authorization parameters for order {order_id}...")
    params = fetch_transfer_authorization_params(api_url, api_key, order_id)
    print(f"       chain_id={params.chain_id} sender={params.sender_address}")
    print(f"       token={params.token_address} escrow={params.recipient_address}")
    print(f"       amount_atomic={params.amount_atomic} nonce={params.forwarder_nonce}")
    print(f"       transfer_data={params.transfer_data[:20]}...")

    print(f"[2/3] Building and signing EIP-712 ForwardRequest...")
    payload = build_authorize_crypto_transfer_payload(
        private_key=private_key,
        params=params,
    )
    print(f"       from={payload['forward_request']['from']}")
    print(f"       data={payload['forward_request']['data'][:20]}...")
    print(f"       nonce={payload['forward_request']['nonce']} deadline={payload['forward_request']['deadline']}")
    print(f"       signature={payload['signature'][:20]}...")

    print(f"[3/3] Submitting to authorize-crypto-transfer...")
    result = submit_authorize_crypto_transfer(api_url, api_key, order_id, payload)
    print(f"       Response: {json.dumps(result, indent=2)}")
    return result


def main():
    parser = argparse.ArgumentParser(
        description="Authorize crypto transfer for a B2B partner offramp order",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Example:
  python3 %(prog)s \\
    --api-url http://localhost:8080 \\
    --api-key test_b2b_key_123 \\
    --order-id 550e8400-e29b-41d4-a716-446655440000 \\
    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
        """,
    )
    parser.add_argument("--api-url", required=True, help="Base URL of the API (e.g. http://localhost:8080)")
    parser.add_argument("--api-key", required=True, help="Partner API key for X-API-Key header")
    parser.add_argument("--order-id", required=True, help="Order UUID to authorize crypto transfer for")
    parser.add_argument("--private-key", required=True, help="Partner custody wallet private key (hex, with or without 0x prefix)")

    args = parser.parse_args()

    try:
        authorize_crypto_transfer(
            api_url=args.api_url.rstrip("/"),
            api_key=args.api_key,
            order_id=args.order_id,
            private_key=args.private_key,
        )
    except requests.HTTPError as e:
        print(f"\nAPI error: {e.response.status_code} {e.response.text}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

/**
 * Partner SDK helper for POST /api/v1/partner/orders/{order_id}/authorize-crypto-transfer
 *
 * Fetches transfer authorization parameters from the API, builds and signs an EIP-712
 * ForwardRequest, and submits it to authorize the crypto transfer.
 *
 * Security: Your private key never leaves your machine. It is used locally to sign the
 * EIP-712 ForwardRequest. Only the signature and unsigned request fields are sent to the API.
 *
 * Dependencies:
 *   npm i ethers
 *
 * Usage:
 *   node partner_authorize_crypto_transfer_sdk.js \
 *     --api-url http://localhost:8080 \
 *     --api-key <partner_api_key> \
 *     --order-id <order_uuid> \
 *     --private-key <partner_wallet_private_key>
 */

const { ethers } = require("ethers");

function toInt(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return Number(value);
}

/**
 * Fetches transfer authorization parameters from the API.
 * @param {string} apiUrl - Base URL of the API
 * @param {string} apiKey - Partner API key
 * @param {string} orderId - Order UUID
 * @returns {Promise<Object>} Transfer authorization parameters
 */
async function fetchTransferAuthorizationParams(apiUrl, apiKey, orderId) {
  const url = `${apiUrl}/api/v1/partner/orders/${orderId}/transfer-authorization-parameters`;
  const resp = await fetch(url, {
    headers: { "X-API-Key": apiKey },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }
  const body = await resp.json();
  if (!body.success) {
    throw new Error(`API error: ${JSON.stringify(body.error || body)}`);
  }
  return body.data;
}

/**
 * Builds unsigned ForwardRequest object using server-provided parameters.
 * The API provides transfer_data (encoded ERC20 transfer calldata), forwarder_nonce,
 * and sender_address so the SDK doesn't need to do any ABI encoding or extra RPC calls.
 * @param {Object} params
 * @param {string} params.privateKey - Partner wallet private key (used to derive sender address for verification)
 * @param {Object} params.authParams - Response from transfer-authorization-parameters endpoint
 * @param {number} [params.deadline] - Optional unix timestamp; defaults to now + recommended_ttl_seconds
 * @returns {Object} Unsigned ForwardRequest matching the on-chain ERC2771Forwarder struct
 */
function buildForwardRequest({ privateKey, authParams, deadline }) {
  const wallet = new ethers.Wallet(privateKey);
  const senderAddress = ethers.getAddress(authParams.sender_address);
  const tokenAddress = ethers.getAddress(authParams.token_address);
  const recommendedGas = toInt(authParams.recommended_gas_limit, 500000);
  const recommendedTtl = toInt(authParams.recommended_ttl_seconds, 3600);

  // Verify the wallet matches the server-provided sender address.
  if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
    throw new Error(
      `Private key derives ${wallet.address} but server expects sender ${senderAddress}`
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const dl = deadline ?? now + recommendedTtl;

  return {
    from: senderAddress,
    to: tokenAddress,
    value: "0",
    gas: String(recommendedGas),
    nonce: authParams.forwarder_nonce,
    deadline: String(dl),
    data: authParams.transfer_data,
  };
}

/**
 * Signs ForwardRequest with EIP-712 typed data matching the on-chain ERC2771Forwarder.
 * Domain and types must match the deployed forwarder contract exactly.
 * @param {Object} params
 * @param {string} params.privateKey - Partner wallet private key
 * @param {Object} params.authParams - Server-provided parameters (chain_id, forwarder_address)
 * @param {Object} params.forwardRequest - Unsigned ForwardRequest to sign
 * @returns {Promise<string>} Hex-encoded EIP-712 signature
 */
async function signForwardRequest({ privateKey, authParams, forwardRequest }) {
  const wallet = new ethers.Wallet(privateKey);
  const chainId = toInt(authParams.chain_id, 0);
  const forwarderAddress = ethers.getAddress(authParams.forwarder_address);

  // EIP-712 domain must match the forwarder contract's constructor parameters.
  // Verified by calling forwarder.eip712Domain() on-chain.
  const domain = {
    name: "SyntheticAssetForwarder",
    version: "1",
    chainId,
    verifyingContract: forwarderAddress,
  };

  // EIP-712 struct type matching the contract's ForwardRequest.
  // The contract verifies: from, to, value, gas, nonce (from storage), deadline, data.
  const types = {
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ],
  };

  return wallet.signTypedData(domain, types, forwardRequest);
}

/**
 * Builds and signs the EIP-712 ForwardRequest using transfer authorization parameters.
 * @param {Object} params
 * @param {string} params.privateKey - Partner custody wallet private key
 * @param {Object} params.authParams - Response from transfer-authorization-parameters endpoint
 * @param {number} [params.deadline] - Optional unix timestamp
 * @returns {Promise<{forward_request: Object, signature: string}>}
 */
async function buildAuthorizeCryptoTransferPayload({ privateKey, authParams, deadline }) {
  const forwardRequest = buildForwardRequest({ privateKey, authParams, deadline });
  const signature = await signForwardRequest({ privateKey, authParams, forwardRequest });
  return { forward_request: forwardRequest, signature };
}

/**
 * Submits the signed payload to authorize-crypto-transfer.
 * @param {string} apiUrl - Base URL of the API
 * @param {string} apiKey - Partner API key
 * @param {string} orderId - Order UUID
 * @param {Object} payload - Signed forward_request + signature
 * @returns {Promise<Object>} API response
 */
async function submitAuthorizeCryptoTransfer(apiUrl, apiKey, orderId, payload) {
  const url = `${apiUrl}/api/v1/partner/orders/${orderId}/authorize-crypto-transfer`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

/**
 * End-to-end: fetches parameters, builds and signs the ForwardRequest, submits it.
 * Only requires API credentials, order ID, and the partner's private key.
 * Everything else (chain, token, forwarder, escrow address, transfer data, nonce)
 * is fetched from the API.
 * @param {Object} opts
 * @param {string} opts.apiUrl - Base URL of the API
 * @param {string} opts.apiKey - Partner API key
 * @param {string} opts.orderId - Order UUID
 * @param {string} opts.privateKey - Partner custody wallet private key
 * @returns {Promise<Object>} API response from authorize-crypto-transfer
 */
async function authorizeCryptoTransfer({ apiUrl, apiKey, orderId, privateKey }) {
  console.log(`[1/3] Fetching transfer authorization parameters for order ${orderId}...`);
  const authParams = await fetchTransferAuthorizationParams(apiUrl, apiKey, orderId);
  console.log(`       chain_id=${authParams.chain_id} sender=${authParams.sender_address}`);
  console.log(`       token=${authParams.token_address} escrow=${authParams.recipient_address}`);
  console.log(`       amount_atomic=${authParams.amount_atomic} nonce=${authParams.forwarder_nonce}`);
  console.log(`       transfer_data=${authParams.transfer_data.slice(0, 20)}...`);

  console.log(`[2/3] Building and signing EIP-712 ForwardRequest...`);
  const payload = await buildAuthorizeCryptoTransferPayload({ privateKey, authParams });
  console.log(`       from=${payload.forward_request.from}`);
  console.log(`       data=${payload.forward_request.data.slice(0, 20)}...`);
  console.log(`       nonce=${payload.forward_request.nonce} deadline=${payload.forward_request.deadline}`);
  console.log(`       signature=${payload.signature.slice(0, 20)}...`);

  console.log(`[3/3] Submitting to authorize-crypto-transfer...`);
  const result = await submitAuthorizeCryptoTransfer(apiUrl, apiKey, orderId, payload);
  console.log(`       Response: ${JSON.stringify(result, null, 2)}`);
  return result;
}

module.exports = {
  fetchTransferAuthorizationParams,
  buildForwardRequest,
  signForwardRequest,
  buildAuthorizeCryptoTransferPayload,
  submitAuthorizeCryptoTransfer,
  authorizeCryptoTransfer,
};

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "").replace(/-/g, "_");
    flags[key] = args[i + 1];
  }

  const required = ["api_url", "api_key", "order_id", "private_key"];
  const missing = required.filter((k) => !flags[k]);
  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.map((k) => "--" + k.replace(/_/g, "-")).join(", ")}`);
    console.error(`\nUsage:`);
    console.error(`  node partner_authorize_crypto_transfer_sdk.js \\`);
    console.error(`    --api-url http://localhost:8080 \\`);
    console.error(`    --api-key test_b2b_key_123 \\`);
    console.error(`    --order-id <order_uuid> \\`);
    console.error(`    --private-key 0x...`);
    process.exit(1);
  }

  authorizeCryptoTransfer({
    apiUrl: flags.api_url.replace(/\/$/, ""),
    apiKey: flags.api_key,
    orderId: flags.order_id,
    privateKey: flags.private_key,
  }).catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  });
}

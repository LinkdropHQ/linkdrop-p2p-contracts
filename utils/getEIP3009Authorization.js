//const ethers = require('ethers');
const { ethers: { utils } } = require('hardhat');

// Generate a random string and convert it to bytes32
function getNonce(from, transferId, amount, expiration, fee) {
  return ethers.utils.solidityKeccak256(
    ['address', 'address', 'uint256', 'uint120', 'uint128'],
    [from, transferId, amount, expiration, fee ]
  )
}

// // The EIP-712 data
// const domain = {
//     name: 'USDC Coin',
//     version: '2',
//     chainId: 1, // Replace with the chain ID of the network you are on
//     verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Replace with the USDC contract address
// };
async function getAuthorization(user, to, amount, validAfter, validBefore, transferId, expiration, domain, fee) {
    // The EIP-712 type data
    const types = {
        ApproveWithAuthorization: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
        ],
    };
  amount = amount.toString()
  const nonce = getNonce(user.address, transferId, amount, expiration, fee.toString())
  const message = {
    owner: user.address,
    spender: to,
    value: amount.toString(),
    validAfter,
    validBefore,
    nonce    
  }

  const signature = await user._signTypedData(domain, types, message);
  const signatureSplit = ethers.utils.splitSignature(signature);
  
    // Encode the authorization
    const authorization = utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes32', 'uint8', 'bytes32', 'bytes32'],
        [message.owner, message.spender, message.value, message.validAfter, message.validBefore, message.nonce, signatureSplit.v, signatureSplit.r, signatureSplit.s]
    );
  
    return authorization;
}

module.exports = getAuthorization

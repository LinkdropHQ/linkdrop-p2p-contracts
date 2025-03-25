const ethers = require('ethers');

async function generateLinkKeyandSignature(sender, transferId, domain) { 
  // Generate a new private key
  const linkKey = ethers.Wallet.createRandom();
  // Create the data to sign
  const types = {
    Transfer: [
      { name: 'linkKeyId', type: 'address' },
      { name: 'transferId', type: 'address' }
    ]
  }
  
  const message = {
    linkKeyId: linkKey.address,
    transferId: transferId
  }
    
  const senderSig = await sender._signTypedData(domain, types, message);
  return { linkKey: linkKey.privateKey, linkKeyId: linkKey.address, senderSig } 
}

async function generateReceiverSig(linkKeyWallet, receiver) {
  const messageHash = ethers.utils.solidityKeccak256(
    ['address'],
    [receiver]
  )
  const messageHashToSign = ethers.utils.arrayify(messageHash)
  const signature = await linkKeyWallet.signMessage(messageHashToSign)
  return signature
}


async function generateFeeAuthorization(relayer,
                                        sender, 
                                        token,
                                        transferId,
                                        tokenId,
                                        amount,
                                        expiration,
                                        feeToken,
                                        feeAmount) {
  const messageHash = ethers.utils.solidityKeccak256(
    ['address', 'address', 'address', 'uint256', 'uint128', 'uint120', 'address', 'uint128'],
    [
      sender,
      token,      
      transferId,
      tokenId,
      amount,
      expiration,
      feeToken,
      feeAmount
    ]
  )
  const messageHashToSign = ethers.utils.arrayify(messageHash)
  const signature = await relayer.signMessage(messageHashToSign)
  return signature
}


module.exports = {
  generateLinkKeyandSignature,
  generateReceiverSig,
  generateFeeAuthorization
}

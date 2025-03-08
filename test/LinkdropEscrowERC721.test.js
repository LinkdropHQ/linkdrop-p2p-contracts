const { expect } = require("chai");
const hre = require("hardhat");
const { generateLinkKeyandSignature, generateReceiverSig, generateFeeAuthorization } = require("../utils/escrowSigUtils");

let owner;
let feeReceiver;
let relayer;
let LinkdropEscrowNFT;
let linkdropEscrowNFT;
let nft;
let sender;
let receiver;
let transferId;
let linkKeyWallet;
const feeToken = ethers.constants.AddressZero
const depositFee = ethers.utils.parseUnits("0.1", 18);

async function redeemRecovered () {
  // User redeems MockTOKEN from LinkdropEscrow
  const chainId = await sender.getChainId();       
  const transferDomain = {
    name: "LinkdropEscrowNFT",
    version: "3.2",
    chainId,
    verifyingContract: linkdropEscrowNFT.address, 
  }
  let { linkKey: newLinkKey, newLinkKeyId, senderSig } = await generateLinkKeyandSignature(sender, transferId, transferDomain)
  const newLinkKeyWallet = new ethers.Wallet(newLinkKey)
  const receiverSig = await generateReceiverSig(newLinkKeyWallet, receiver.address)
  await linkdropEscrowNFT.connect(relayer).redeemRecovered(receiver.address, sender.address, nft.address, transferId, receiverSig, senderSig);
}

async function makeDepositERC721 (tokenId, sponsored = true, senderMessage="0x") {
  const {
    depositCall,
    transferId,
    expiration,
  } = await prepareDepositCall(tokenId, sponsored, senderMessage)

  await depositCall()
  
  return {
    transferId,
    tokenId,
    expiration,
  }
}

// Function to make a deposit for an ERC721 token
async function prepareDepositCall(tokenId, sponsored, senderMessage) {
  const feeAmount = sponsored ? 0 : depositFee;
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now

  const feeAuthorization = await generateFeeAuthorization(
    relayer,
    sender.address,
    nft.address,
    transferId,
    tokenId,
    1, // amount is 1 for ERC721
    expiration,
    feeToken,
    feeAmount
  );

  await nft.connect(sender).approve(linkdropEscrowNFT.address, tokenId);

  // User deposits NFT into LinkdropEscrowNFT
  const depositCall = () => linkdropEscrowNFT.connect(sender).depositERC721(
    nft.address,
    transferId,
    tokenId,
    expiration,
    feeAmount,
    feeAuthorization,
    senderMessage,
    { value: feeAmount }
  );

  return {
    depositCall,
    transferId,
    tokenId,
    expiration
  };
}

describe("LinkdropEscrowNFT", function () {
  beforeEach(async function () {
    [owner, feeReceiver, relayer, sender, receiver, linkKeyWallet, ...addrs] = await ethers.getSigners();

    const NFT = await ethers.getContractFactory("ERC721Mock");
    nft = await NFT.deploy();
    await nft.safeMint(sender.address);

    transferId = linkKeyWallet.address;

    LinkdropEscrowNFT = await ethers.getContractFactory("LinkdropEscrowNFT");
    linkdropEscrowNFT = await LinkdropEscrowNFT.deploy(relayer.address);
    await linkdropEscrowNFT.deployed();
  });

  describe("deposit ERC721", function () {
    it("Should deposit NFT directly (not sponsored)", async function () {
      const tokenId = 1;
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC721(tokenId, false);

      // Check that the NFT was transferred
      expect(await nft.ownerOf(tokenId)).to.equal(linkdropEscrowNFT.address);      
      let escrowBalance = await ethers.provider.getBalance(linkdropEscrowNFT.address)
      expect(escrowBalance).to.equal(depositFee);      
      expect(await linkdropEscrowNFT.accruedFees(feeToken)).to.equal(depositFee);

      
      const deposit = await linkdropEscrowNFT.getDeposit(nft.address, sender.address, transferId);
      expect(deposit.tokenId).to.equal(depositedTokenId);
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.amount).to.equal(1);            
      expect(deposit.token).to.equal(nft.address);
    });

    it("Should deposit NFT directly (sponsored)", async function () {
      const tokenId = 1;
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC721(tokenId, true);

      // Check that the NFT was transferred
      expect(await nft.ownerOf(tokenId)).to.equal(linkdropEscrowNFT.address);
      let escrowBalance = await ethers.provider.getBalance(linkdropEscrowNFT.address)
      expect(escrowBalance).to.equal(0);      
      
      expect(await linkdropEscrowNFT.accruedFees(feeToken)).to.equal(0);
      
      const deposit = await linkdropEscrowNFT.getDeposit(nft.address, sender.address, transferId);
      expect(deposit.tokenId).to.equal(depositedTokenId);
      expect(deposit.expiration).to.equal(expiration);
        expect(deposit.amount).to.equal(1);            
      expect(deposit.token).to.equal(nft.address);
    });

    it("Should log sender message in event", async function () {
      const senderMessage = "0x002a5a48f0eee01056febc3398e98d70e4d05936395b0a1fce28abaa333f6712720b5acc8e1fb4b721bb8ab423db2121e12fcd7eaa41c97731fdf56a8638"
      const { depositCall, amount, expiration, transferId } = await prepareDepositCall(1, false, message=senderMessage)

      // Verify the event was emitted with the correct parameters
      await expect(await depositCall())
        .to.emit(linkdropEscrowNFT, "SenderMessage")
        .withArgs(sender.address, transferId, senderMessage);
    })
  });

  describe("onERC721Received", function () {
    it("Should handle direct NFT transfer with data", async function () {
        const tokenId = 1;
        const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
        const feeAmount = 0;
        const feeAuthorization = await generateFeeAuthorization(
            relayer,
            sender.address,
            nft.address,
            transferId, 
            tokenId,
            1, // amount is 1 for ERC721
            expiration,
            ethers.constants.AddressZero,
            feeAmount
        );

        // Encoding transferId, expiration, feeAmount, and feeAuthorization into bytes
        const data = ethers.utils.defaultAbiCoder.encode(
            ["address", "uint120", "uint128", "bytes"],
            [transferId, expiration, feeAmount, feeAuthorization]
        );
           
      const decoded = await linkdropEscrowNFT.connect(sender).decodeOnERC721ReceivedData(data)
      
        await nft.connect(sender)['safeTransferFrom(address,address,uint256,bytes)'](
          sender.address,
          linkdropEscrowNFT.address,
          tokenId,
          data
        );

        expect(await nft.ownerOf(tokenId)).to.equal(linkdropEscrowNFT.address);
        const deposit = await linkdropEscrowNFT.getDeposit(nft.address, sender.address, transferId);
        expect(deposit.tokenId).to.equal(tokenId);
        expect(deposit.expiration).to.equal(expiration);
        expect(deposit.amount).to.equal(1);      
        expect(deposit.token).to.equal(nft.address);
    });
  });

  describe("redeem", function () {
    it("Should redeem NFT via original claim link", async function () {
      const tokenId = 1
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC721(tokenId, true);
      const receiverSig = await generateReceiverSig(linkKeyWallet, receiver.address)
      await linkdropEscrowNFT.connect(relayer).redeem(receiver.address, sender.address, nft.address, receiverSig);

      // Check that the token was redeemed
      expect(await nft.ownerOf(tokenId)).to.equal(receiver.address);
      expect((await linkdropEscrowNFT.getDeposit(nft.address, sender.address, transferId)).amount).to.equal(0);
    })

    it("Should redeem token via recovered link", async function () {
      const tokenId = 1
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC721(tokenId, true);

      expect(await nft.ownerOf(tokenId)).to.equal(linkdropEscrowNFT.address);
      
      // REDEEM 
      await redeemRecovered()
      
      // Check that the TOKEN was redeemed
      expect(await nft.ownerOf(tokenId)).to.equal(receiver.address);
      expect((await linkdropEscrowNFT.getDeposit(nft.address, sender.address, transferId)).amount).to.equal(0);
    })
  });
  describe("refund", function () {    
    it("Should fail if the caller is not a relayer", async function () {
      const tokenId = 1
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC721(tokenId, true);
      
      // Try to refund funds as another user
      await expect(
        linkdropEscrowNFT.connect(addrs[0]).refund(sender.address, nft.address, transferId)
      ).to.be.revertedWith("LinkdropEscrow: msg.sender is not relayer.");
    });

    it("Should refund token to original sender", async function () {      
      const tokenId = 1
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC721(tokenId, true);
      
      // wait for 25 hours
      await network.provider.send("evm_increaseTime", [60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block
      
      // Refund the deposit
      await linkdropEscrowNFT.connect(relayer).refund(sender.address, nft.address, transferId);

      // Check that the TOKEN was refunded and deposit is zero
      expect(await nft.ownerOf(tokenId)).to.equal(sender.address);
      expect((await linkdropEscrowNFT.getDeposit(nft.address, sender.address, transferId)).amount).to.equal(0);

      // reset back EVM time
      await network.provider.send("evm_increaseTime", [-60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block      
    });    
  });
});

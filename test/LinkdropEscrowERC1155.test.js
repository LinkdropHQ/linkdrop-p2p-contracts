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
    version: "3.1",
    chainId,
    verifyingContract: linkdropEscrowNFT.address, 
  }
  let { linkKey: newLinkKey, newLinkKeyId, senderSig } = await generateLinkKeyandSignature(sender, transferId, transferDomain)
  const newLinkKeyWallet = new ethers.Wallet(newLinkKey)
  const receiverSig = await generateReceiverSig(newLinkKeyWallet, receiver.address)
  await linkdropEscrowNFT.connect(relayer).redeemRecovered(receiver.address, sender.address, nft.address, transferId, receiverSig, senderSig);
}

// Function to make a deposit for an ERC1155 token
async function makeDepositERC1155(tokenId, sponsored = true) {
  const feeAmount = sponsored ? 0 : depositFee;
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
  const amount = 1
  const feeAuthorization = await generateFeeAuthorization(
    relayer,
    sender.address,
    nft.address,
    transferId,
    tokenId,
    amount, 
    expiration,
    feeToken,
    feeAmount
  );

  await nft.connect(sender).setApprovalForAll(linkdropEscrowNFT.address, true);
  
  // User deposits NFT into LinkdropEscrowNFT
  await linkdropEscrowNFT.connect(sender).depositERC1155(
    nft.address,
    transferId,
    tokenId,
    amount,
    expiration,
    feeAmount,
    feeAuthorization,
    { value: feeAmount }
  );

  return {
    transferId,
    tokenId,
    expiration
  };
}

describe("LinkdropEscrowNFT", function () {
  beforeEach(async function () {
    [owner, feeReceiver, relayer, sender, receiver, linkKeyWallet, ...addrs] = await ethers.getSigners();

    const NFT = await ethers.getContractFactory("ERC1155Mock");
    nft = await NFT.deploy();
    const tokenId = 1
    const amount = 1
    await nft.mintTo(sender.address, 1, 1);

    transferId = linkKeyWallet.address;

    LinkdropEscrowNFT = await ethers.getContractFactory("LinkdropEscrowNFT");
    linkdropEscrowNFT = await LinkdropEscrowNFT.deploy(relayer.address);
    await linkdropEscrowNFT.deployed();
  });

  describe("deposit ERC1155", function () {
    it("Should deposit NFT directly (not sponsored)", async function () {
      const tokenId = 1;
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC1155(tokenId, false);

      // Check that the NFT was transferred
      expect(await nft.balanceOf(linkdropEscrowNFT.address, tokenId)).to.equal(1);      
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
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC1155(tokenId, true);

      // Check that the NFT was transferred
      expect(await nft.balanceOf(linkdropEscrowNFT.address, tokenId)).to.equal(1);
      let escrowBalance = await ethers.provider.getBalance(linkdropEscrowNFT.address)
      expect(escrowBalance).to.equal(0);      
      
      expect(await linkdropEscrowNFT.accruedFees(feeToken)).to.equal(0);

      
      const deposit = await linkdropEscrowNFT.getDeposit(nft.address, sender.address, transferId);
      expect(deposit.tokenId).to.equal(depositedTokenId);
      expect(deposit.expiration).to.equal(expiration);
        expect(deposit.amount).to.equal(1);            
      expect(deposit.token).to.equal(nft.address);
    });
  });

  describe("onERC1155Received", function () {
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
            1, // amount is 1 for ERC1155
            expiration,
            ethers.constants.AddressZero,
            feeAmount
        );

        // Encoding transferId, expiration, feeAmount, and feeAuthorization into bytes
        const data = ethers.utils.defaultAbiCoder.encode(
            ["address", "uint120", "uint128", "bytes"],
            [transferId, expiration, feeAmount, feeAuthorization]
        );
           
      //const decoded = await linkdropEscrowNFT.connect(sender).decodeOnERC1155ReceivedData(data)
      
      await nft.connect(sender)['safeTransferFrom(address,address,uint256,uint256,bytes)'](
        sender.address,
        linkdropEscrowNFT.address,
        tokenId,
        1,
        data
      );

      expect(await nft.balanceOf(linkdropEscrowNFT.address, tokenId)).to.equal(1);
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
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC1155(tokenId, true);
      const receiverSig = await generateReceiverSig(linkKeyWallet, receiver.address)
      await linkdropEscrowNFT.connect(relayer).redeem(receiver.address, sender.address, nft.address, receiverSig);

      // Check that the token was redeemed
      expect(await nft.balanceOf(receiver.address, tokenId)).to.equal(1);
      expect((await linkdropEscrowNFT.getDeposit(nft.address, sender.address, transferId)).amount).to.equal(0);
    })

    it("Should redeem token via recovered link", async function () {
      const tokenId = 1
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC1155(tokenId, true);

      expect(await nft.balanceOf(linkdropEscrowNFT.address, tokenId)).to.equal(1);
      
      // REDEEM 
      await redeemRecovered()
      
      // Check that the TOKEN was redeemed
      expect(await nft.balanceOf(receiver.address, tokenId)).to.equal(1);
      expect((await linkdropEscrowNFT.getDeposit(nft.address, sender.address, transferId)).amount).to.equal(0);
    })
  });
  describe("refund", function () {    
    it("Should fail if the caller is not a relayer", async function () {
      const tokenId = 1
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC1155(tokenId, true);
      
      // Try to refund funds as another user
      await expect(
        linkdropEscrowNFT.connect(addrs[0]).refund(sender.address, nft.address, transferId)
      ).to.be.revertedWith("LinkdropEscrow: msg.sender is not relayer.");
    });

    it("Should refund token to original sender", async function () {      
      const tokenId = 1
      const { tokenId: depositedTokenId, expiration, transferId } = await makeDepositERC1155(tokenId, true);
      
      // wait for 25 hours
      await network.provider.send("evm_increaseTime", [60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block
      
      // Refund the deposit
      await linkdropEscrowNFT.connect(relayer).refund(sender.address, nft.address, transferId);

      // Check that the TOKEN was refunded and deposit is zero
      expect(await nft.balanceOf(sender.address, tokenId)).to.equal(1);
      expect((await linkdropEscrowNFT.getDeposit(nft.address, sender.address, transferId)).amount).to.equal(0);

      // reset back EVM time
      await network.provider.send("evm_increaseTime", [-60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block      
    });    
  });
});

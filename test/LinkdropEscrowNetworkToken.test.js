const { expect } = require("chai");
const hre = require("hardhat");
const getAuthorization = require("../utils/getEIP3009Authorization")
const { generateLinkKeyandSignature, generateReceiverSig } = require("../utils/escrowSigUtils");

let owner;
let feeReceiver;
let relayer;
let LinkdropEscrow;
let linkdropEscrow;
let usdc;
let sender;
let claimFee;
let depositFee;
let transferId;
let linkKeyWallet;

// Generate validAfter and validBefore timestamps
function getValidAfterAndBefore() {
    const now = Math.floor(Date.now() / 1000);
    const validAfter = now - 60; // valid 1 minute ago
    const validBefore = now + 60 * 60; // valid for the next 1 hour
    return [validAfter, validBefore];
}

async function makeDeposit () {
  // Define some values for the deposit
  const amount = ethers.utils.parseUnits("0.2", 18);  // 10 eth
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
  
  await sender.sendTransaction({
    to: linkdropEscrow.address,
    value: amount,
    gasLimit: 1000000, // Ensure you have enough gas
    data: linkdropEscrow.interface.encodeFunctionData("deposit", [transferId, expiration])
  });
  
  return {
    transferId,
    amount,
    expiration,
  }
}

async function redeemRecovered (sponsored=true) {
      // User redeems MockUSDC from LinkdropEscrow
      const chainId = await sender.getChainId();       
      const transferDomain = {
        name: "LinkdropEscrow",
        version: "2",
        chainId, // Replace with your actual chainId
        verifyingContract: linkdropEscrow.address, // Replace with your actual contract address
      }
      let { linkKey: newLinkKey, newLinkKeyId, senderSig } = await generateLinkKeyandSignature(sender, transferId, transferDomain)
      const newLinkKeyWallet = new ethers.Wallet(newLinkKey)
      const receiverSig = await generateReceiverSig(newLinkKeyWallet, receiver.address)
      await linkdropEscrow.connect(relayer).redeemRecovered(receiver.address, transferId, receiverSig, senderSig, sponsored);
}

describe("LinkdropEscrowNetworkToken", function () {
  beforeEach(async function () {
    [owner,feeReceiver, relayer, sender, linkKeyWallet, ...addrs] = await ethers.getSigners();

    receiver = ethers.Wallet.createRandom()
    claimFee = ethers.utils.parseUnits("0.05", 18)
    depositFee = ethers.utils.parseUnits("0.05", 18)    
    transferId = linkKeyWallet.address;
    
    LinkdropEscrow = await ethers.getContractFactory("LinkdropEscrowNetworkToken");
    linkdropEscrow = await LinkdropEscrow.deploy(relayer.address, claimFee);    
    await linkdropEscrow.deployed();
  });

  describe("escrow contract", function () {
    it("Should have correct owner", async function () {
      await expect(await linkdropEscrow.owner()).to.be.equal(owner.address)
    })
    it("Should have correct token", async function () {
      await expect(await linkdropEscrow.token()).to.be.equal(ethers.constants.AddressZero)
    })    
  })
  
  describe("deposit", function () {
    it("Should fail if expiration is invalid", async function () {
      const amount = ethers.utils.parseUnits("1", 18);  // 10 eth
      const expiration = Math.floor(Date.now() / 1000) - 60 * 60 * 24; // 24 hours from now
      
      await expect(sender.sendTransaction({
        to: linkdropEscrow.address,
        value: amount,
        gasLimit: 1000000, // Ensure you have enough gas
        data: linkdropEscrow.interface.encodeFunctionData("deposit", [transferId, expiration])
      })).to.be.revertedWith("LinkdropEscrow: depositing with invalid expiration.");
    });
    
    it("Should deposit ETH", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      
      // Check that the USDC was transferred
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(amount);
      expect(await linkdropEscrow.accruedFees()).to.equal(0);

      const deposit = await linkdropEscrow.getDeposit(sender.address, transferId)
      expect(deposit.amount).to.equal(amount);
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.tokenAddress).to.equal(ethers.constants.AddressZero);      
    })
        
    
    it("Should redeem ETH via original claim link (sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      const receiverSig = await generateReceiverSig(linkKeyWallet, receiver.address)
      await linkdropEscrow.connect(relayer).redeem(receiver.address, sender.address, receiverSig, true);

      // Check that the USDC was redeemed
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(0);
      expect(await ethers.provider.getBalance(receiver.address)).to.equal(amount);
      expect((await linkdropEscrow.getDeposit(sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees()).to.equal(0);     
    })

    it("Should redeem ETH via recovered link (sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(amount);
      
      // REDEEM 
      await redeemRecovered(true)
      
      // Check that the USDC was redeemed
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(0);
      expect(await ethers.provider.getBalance(receiver.address)).to.equal(amount);
      expect((await linkdropEscrow.getDeposit(sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees()).to.equal(0);       
    })

    it("Should redeem ETH via original claim link (non-sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      const receiverSig = await generateReceiverSig(linkKeyWallet, receiver.address)
      await linkdropEscrow.connect(relayer).redeem(receiver.address, sender.address, receiverSig, false);

      // Check that the USDC was redeemed
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(claimFee);
      expect(await ethers.provider.getBalance(receiver.address)).to.equal(amount.sub(claimFee));
      expect((await linkdropEscrow.getDeposit(sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees()).to.equal(claimFee);     
    })

    it("Should redeem ETH via recovered link (non-sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(amount);
      
      // REDEEM 
      await redeemRecovered(false)
      
      // Check that the USDC was redeemed
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(claimFee);
      expect(await ethers.provider.getBalance(receiver.address)).to.equal(amount.sub(claimFee));
      expect((await linkdropEscrow.getDeposit(sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees()).to.equal(claimFee);
    })

    it("Should withdraw accrued fees", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      await redeemRecovered(false)
      let accruedAmount = await linkdropEscrow.accruedFees()
      expect(accruedAmount).to.equal(depositFee);
      let ownerBalance = await ethers.provider.getBalance(owner.address)
      let escrowBalance = await ethers.provider.getBalance(linkdropEscrow.address)
      
      await linkdropEscrow.connect(owner).withdrawAccruedFees()
      expect(await linkdropEscrow.accruedFees()).to.equal(0);
      expect(await ethers.provider.getBalance(owner.address)).to.be.gt(ownerBalance);
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(escrowBalance - accruedAmount);
    })
    
    it("Should not withdraw accrued fees multiple times", async function () {
        const { amount, expiration, transferId } = await makeDeposit()              
        const accruedAmount = await linkdropEscrow.accruedFees()
        expect(accruedAmount).to.equal(0);
        const ownerBalance = await ethers.provider.getBalance(owner.address)
        const escrowBalance = await ethers.provider.getBalance(linkdropEscrow.address)
      
        await linkdropEscrow.connect(owner).withdrawAccruedFees()
        expect(await linkdropEscrow.accruedFees()).to.equal(0);
        expect(await ethers.provider.getBalance(owner.address)).to.be.lt(ownerBalance);
        expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(escrowBalance);      
    })
  });
  

  describe("refund", function () {
    
    it("Should fail if the caller is not a relayer", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      
      // Try to refund funds as another user
      await expect(
        linkdropEscrow.connect(addrs[0]).refund(sender.address, transferId, true)
      ).to.be.revertedWith("LinkdropEscrow: msg.sender is not relayer.");
    });

    it("Should fail if transfer is not expired", async function () {
        const { amount, expiration, transferId } = await makeDeposit()
      await expect(
        linkdropEscrow.connect(relayer).refund(sender.address, transferId, true)
      ).to.be.revertedWith("LinkdropEscrow: transfer not expired yet.");
    });


    it("Should refund USDC to original sender (non-sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      const usdcBalanceAfterDeposit = await ethers.provider.getBalance(sender.address)
      
      // wait for 25 hours
      await network.provider.send("evm_increaseTime", [60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block
      
      // Refund the deposit
      await linkdropEscrow.connect(relayer).refund(sender.address, transferId, false);

      // Check that the USDC was refunded and deposit is zero
      expect(await ethers.provider.getBalance(sender.address)).to.equal(usdcBalanceAfterDeposit.add(amount.sub(claimFee)));
      expect((await linkdropEscrow.getDeposit(sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees()).to.equal(claimFee);

      // reset back EVM time
      await network.provider.send("evm_increaseTime", [-60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block      
    });

    it("Should refund USDC to original sender (sponsored)", async function () {

      
      const { amount, expiration, transferId } = await makeDeposit()
      const usdcBalanceAfterDeposit = await ethers.provider.getBalance(sender.address)
      
      // wait for 25 hours
      await network.provider.send("evm_increaseTime", [60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block
      
      // Refund the deposit
      await linkdropEscrow.connect(relayer).refund(sender.address, transferId, true);

      // Check that the USDC was refunded and deposit is zero
      expect(await ethers.provider.getBalance(sender.address)).to.equal(usdcBalanceAfterDeposit.add(amount));
      expect((await linkdropEscrow.getDeposit(sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees()).to.equal(0);

      // reset back EVM time
      await network.provider.send("evm_increaseTime", [-60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block            
    });    
  });
});

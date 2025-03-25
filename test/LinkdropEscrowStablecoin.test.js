const { expect } = require("chai");
const hre = require("hardhat");
const getAuthorization = require("../utils/getEIP3009Authorization")
const { generateLinkKeyandSignature, generateReceiverSig, generateFeeAuthorization } = require("../utils/escrowSigUtils");

let owner;
let feeReceiver;
let relayer;
let LinkdropEscrow;
let linkdropEscrow;
let usdc;
let sender;
let transferId;
let linkKeyWallet;


const APPROVE_SELECTOR = "0xe1560fd3"
const RECEIVE_SELECTOR = "0xef55bec6"
const depositFee = ethers.utils.parseUnits("0.1", 6);

// Generate validAfter and validBefore timestamps
function getValidAfterAndBefore() {
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60; // valid 1 minute ago
  const validBefore = now + 60 * 60; // valid for the next 1 hour
  return [validAfter, validBefore];
}

async function depositWithAuthorization (sponsored=true, selector=RECEIVE_SELECTOR) {
  // Define some values for the deposit
  const amount = ethers.utils.parseUnits("100", 6);  // 100 USDC
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
  const fee = sponsored ? 0 : depositFee;
  
  // User approves LinkdropEscrow to spend MockUSDC
  // The EIP-712 data
  const name = await usdc.name()
  const version = await usdc.version()
  const chainId = await sender.getChainId();      
  const domain = {
    name: name,
    version: version,
    chainId: chainId, // Replace with the chain ID of the network you are on
    verifyingContract: usdc.address, // Replace with the USDC contract address
  };
  const [validAfter, validBefore] = getValidAfterAndBefore();
  const authorization = await getAuthorization(sender, linkdropEscrow.address, amount, validAfter, validBefore, transferId, expiration, domain, fee)

  // User deposits MockUSDC into LinkdropEscrow
  await linkdropEscrow.connect(relayer).depositWithAuthorization(
    usdc.address,
    transferId,
    expiration,
    selector,    
    fee,
    authorization
  );
  return {
    transferId,
    amount,
    expiration,
  }
}

async function makeDeposit (sponsored=true) {
  // Define some values for the deposit
  const amount = ethers.utils.parseUnits("100", 6);  // 100 USDC
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
  const fee = sponsored ? 0 : depositFee;

  const feeAuthorization = await generateFeeAuthorization(
    relayer,
    sender.address,
    usdc.address,
    transferId,
    0, // tokenId is 0 for ERC20
    amount,
    expiration,
    usdc.address,
    fee)

  await usdc.connect(sender).approve(linkdropEscrow.address, amount);
  
  // User deposits MockUSDC into LinkdropEscrow
  await linkdropEscrow.connect(sender).deposit(
    usdc.address,
    transferId,
    amount,
    expiration,
    usdc.address,
    fee,
    feeAuthorization
  );
  return {
    transferId,
    amount,
    expiration,
  }
}


async function redeemRecovered () {
  // User redeems MockUSDC from LinkdropEscrow
  const chainId = await sender.getChainId();       
  const transferDomain = {
    name: "LinkdropEscrow",
    version: "3.1",
    chainId, // Replace with your actual chainId
    verifyingContract: linkdropEscrow.address, // Replace with your actual contract address
  }
  let { linkKey: newLinkKey, newLinkKeyId, senderSig } = await generateLinkKeyandSignature(sender, transferId, transferDomain)
  const newLinkKeyWallet = new ethers.Wallet(newLinkKey)
  const receiverSig = await generateReceiverSig(newLinkKeyWallet, receiver.address)
  await linkdropEscrow.connect(relayer).redeemRecovered(receiver.address, sender.address, usdc.address, transferId, receiverSig, senderSig);
}

describe("LinkdropEscrowStablecoin", function () {
  beforeEach(async function () {
    [owner,feeReceiver, relayer, sender, receiver, linkKeyWallet, ...addrs] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory("MockUSDC");
    usdc = await USDC.deploy();

    await usdc.transfer(sender.address, ethers.utils.parseUnits("10000", 6));

    transferId = linkKeyWallet.address;

    
    LinkdropEscrow = await ethers.getContractFactory("LinkdropEscrow");
    linkdropEscrow = await LinkdropEscrow.deploy(relayer.address);    
    await linkdropEscrow.deployed();
  });

  describe("escrow contract", function () {
    it("Should have correct owner", async function () {
      await expect(await linkdropEscrow.owner()).to.be.equal(owner.address)
    })
  })
  
  describe("depositWithAuthorization", function () {
    
    it("Should fail if the caller is not a relayer", async function () {
      const receiveAuthorization = ethers.utils.randomBytes(96); // a random byte array for testing
      const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
      
      await expect(
        linkdropEscrow.connect(addrs[0]).depositWithAuthorization(usdc.address, transferId, expiration, RECEIVE_SELECTOR, 0, receiveAuthorization)
      ).to.be.revertedWith("LinkdropEscrow: msg.sender is not relayer.");
    });

    it("Should fail if recipient is not the contract", async function () {
      const from = addrs[0].address;
      const to = addrs[1].address;
      const amount = ethers.utils.parseUnits("1", 6); // amount in USDC format
      const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now      
      const receiveAuthorization = ethers.utils.defaultAbiCoder.encode(["address", "address", "uint256", "uint256", "uint256", "uint256"], [from, to, amount, amount, amount, amount]);

      await expect(
        linkdropEscrow.connect(relayer).depositWithAuthorization(usdc.address, transferId, expiration, RECEIVE_SELECTOR, 0, receiveAuthorization)
      ).to.be.revertedWith("LinkdropEscrow: receiveAuthorization_ decode fail. Recipient is not this contract.");
    });

    it("Should fail if expiration is invalid", async function () {
      // Define some values for the deposit
      const amount = ethers.utils.parseUnits("100", 6);  // 100 USDC
      const expiration = Math.floor(Date.now() / 1000) - 60 * 60 ; // 1 minute ago

      // User approves LinkdropEscrow to spend MockUSDC
      // The EIP-712 data
      const name = await usdc.name()
      const version = await usdc.version()
      const chainId = await sender.getChainId();      
      const domain = {
        name: name,
        version: version,
        chainId: chainId, // Replace with the chain ID of the network you are on
        verifyingContract: usdc.address, // Replace with the USDC contract address
      };
      const [validAfter, validBefore] = getValidAfterAndBefore();
      const authorization = await getAuthorization(sender, linkdropEscrow.address, amount, validAfter, validBefore, transferId, expiration, domain, 0)

      await expect(
        linkdropEscrow.connect(relayer).depositWithAuthorization(usdc.address, transferId, expiration, RECEIVE_SELECTOR, 0, authorization)
      )
        .to.be.revertedWith("LinkdropEscrow: depositing with invalid expiration.");
    });
    
    it("Should deposit USDC with authorization (not sponsored)", async function () {
      const { amount, expiration, transferId } = await depositWithAuthorization(false)
      
      // Check that the USDC was transferred
      const fees = depositFee
      expect(await usdc.balanceOf(linkdropEscrow.address)).to.equal(amount);
      expect(await linkdropEscrow.accruedFees(usdc.address)).to.equal(fees);

      const deposit = await linkdropEscrow.getDeposit(usdc.address, sender.address, transferId)
      expect(deposit.amount).to.equal(amount.sub(fees));
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.token).to.equal(usdc.address);
    })

    it("Should deposit USDC with receive authorization (sponsored)", async function () {
      const { amount, expiration, transferId } = await depositWithAuthorization(true, RECEIVE_SELECTOR)      
      // Check that the USDC was transferred
      expect(await usdc.balanceOf(linkdropEscrow.address)).to.equal(amount);
      expect(await linkdropEscrow.accruedFees(usdc.address)).to.equal(0);

      const deposit = await linkdropEscrow.getDeposit(usdc.address, sender.address, transferId)
      expect(deposit.amount).to.equal(amount);
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.token).to.equal(usdc.address);
    })
    
    it("Should deposit USDC with approve authorization (sponsored)", async function () {
      const { amount, expiration, transferId } = await depositWithAuthorization(true, APPROVE_SELECTOR)      
      // Check that the USDC was transferred
      expect(await usdc.balanceOf(linkdropEscrow.address)).to.equal(amount);
      expect(await linkdropEscrow.accruedFees(usdc.address)).to.equal(0);

      const deposit = await linkdropEscrow.getDeposit(usdc.address, sender.address, transferId)
      expect(deposit.amount).to.equal(amount);
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.token).to.equal(usdc.address);
    })        
  })

  describe("withdraw fees", function () {
    it("Should withdraw accrued fees", async function () {
      const { amount, expiration, transferId } = await depositWithAuthorization(false)      
      let accruedAmount = await linkdropEscrow.accruedFees(usdc.address)
      expect(accruedAmount).to.equal(depositFee);
      let ownerBalance = await usdc.balanceOf(owner.address)
      let escrowBalance = await usdc.balanceOf(linkdropEscrow.address)
      
      await linkdropEscrow.connect(owner).withdrawAccruedFees(usdc.address)
      expect(await linkdropEscrow.accruedFees(usdc.address)).to.equal(0);
      expect(await usdc.balanceOf(owner.address)).to.equal(ownerBalance.add(accruedAmount));
      expect(await usdc.balanceOf(linkdropEscrow.address)).to.equal(escrowBalance - accruedAmount);
    })
    it("Should not withdraw accrued fees multiple times", async function () {
      const { amount, expiration, transferId } = await depositWithAuthorization(true)              
      const accruedAmount = await linkdropEscrow.accruedFees(usdc.address)
      expect(accruedAmount).to.equal(0);
      const ownerBalance = await usdc.balanceOf(owner.address)
      const escrowBalance = await usdc.balanceOf(linkdropEscrow.address)
      
      await linkdropEscrow.connect(owner).withdrawAccruedFees(usdc.address)
      expect(await linkdropEscrow.accruedFees(usdc.address)).to.equal(0);
      expect(await usdc.balanceOf(owner.address)).to.equal(ownerBalance);
      expect(await usdc.balanceOf(linkdropEscrow.address)).to.equal(escrowBalance);      
    })
    
  })
  describe("redeem", function () {
    it("Should redeem USDC via original claim link", async function () {
      const { amount, expiration, transferId } = await depositWithAuthorization(true)
      const receiverSig = await generateReceiverSig(linkKeyWallet, receiver.address)
      await linkdropEscrow.connect(relayer).redeem(receiver.address, sender.address, usdc.address, receiverSig);

      // Check that the USDC was redeemed
      expect(await usdc.balanceOf(linkdropEscrow.address)).to.equal(0);
      expect(await usdc.balanceOf(receiver.address)).to.equal(amount);
      expect((await linkdropEscrow.getDeposit(usdc.address, sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees(usdc.address)).to.equal(0);     
    })

    it("Should redeem USDC via recovered link", async function () {
      const { amount, expiration, transferId } = await depositWithAuthorization(true)
      expect(await usdc.balanceOf(linkdropEscrow.address)).to.equal(amount);
      
      // REDEEM 
      await redeemRecovered()
      
      // Check that the USDC was redeemed
      expect(await usdc.balanceOf(linkdropEscrow.address)).to.equal(0);
      expect(await usdc.balanceOf(receiver.address)).to.equal(amount);
      expect((await linkdropEscrow.getDeposit(usdc.address, sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees(usdc.address)).to.equal(0);       
    })

  });

  describe("deposit", function () {    
    it("Should deposit USDC direclty (not sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit(false)
      
      // Check that the USDC was transferred
      const fees = depositFee
      expect(await usdc.balanceOf(linkdropEscrow.address)).to.equal(amount);
      expect(await linkdropEscrow.accruedFees(usdc.address)).to.equal(fees);

      const deposit = await linkdropEscrow.getDeposit(usdc.address, sender.address, transferId)
      expect(deposit.amount).to.equal(amount.sub(fees));
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.token).to.equal(usdc.address);
    })
    
    
    it("Should deposit USDC directly (sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit(true)      

      // Check that the USDC was transferred
      expect(await usdc.balanceOf(linkdropEscrow.address)).to.equal(amount);
      expect(await linkdropEscrow.accruedFees(usdc.address)).to.equal(0);

      const deposit = await linkdropEscrow.getDeposit(usdc.address, sender.address, transferId)
      expect(deposit.amount).to.equal(amount);
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.token).to.equal(usdc.address);
    })
  })
  
  describe("refund", function () {
    
    it("Should fail if the caller is not a relayer", async function () {
      const { amount, expiration, transferId } = await depositWithAuthorization(true)
      
      // Try to refund funds as another user
      await expect(
        linkdropEscrow.connect(addrs[0]).refund(sender.address, usdc.address, transferId)
      ).to.be.revertedWith("LinkdropEscrow: msg.sender is not relayer.");
    });

    it("Should refund USDC to original sender (sponsored)", async function () {      
      const { amount, expiration, transferId } = await depositWithAuthorization(true)
      const usdcBalanceAfterDeposit = await usdc.balanceOf(sender.address)
      
      // wait for 25 hours
      await network.provider.send("evm_increaseTime", [60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block
      
      // Refund the deposit
      await linkdropEscrow.connect(relayer).refund(sender.address, usdc.address, transferId);

      // Check that the USDC was refunded and deposit is zero
      expect(await usdc.balanceOf(sender.address)).to.equal(usdcBalanceAfterDeposit.add(amount));
      expect((await linkdropEscrow.getDeposit(usdc.address, sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees(usdc.address)).to.equal(0);

      // reset back EVM time
      await network.provider.send("evm_increaseTime", [-60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block      
    });    
  });

});

// SPDX-License-Identifier: GPL-3.0
/**
 * @title LinkdropEscrowNetworkToken
 * @author Mikhail Dobrokhvalov <mikhail@linkdrop.io>
 * @contact https://www.linkdrop.io
 * @dev This is an implementation of the escrow contract for Linkdrop P2P. Linkdrop P2P allows a new type of token transfers, comparable to a signed blank check with a pre-defined amount. In this system, the sender does not set the destination address. Instead, they deposit tokens into the Escrow Contract, create a claim link, and share it with the recipient. The recipient can then use the claim link to redeem the escrowed tokens from the Escrow Contract. If the claim link is not redeemed before the expiration date set by the sender, the escrowed tokens are transferred back to the sender.
 */

pragma solidity ^0.8.17;

import "openzeppelin-solidity/contracts/utils/cryptography/ECDSA.sol";
import "openzeppelin-solidity/contracts/access/Ownable.sol";
import "./EIP712.sol";

contract LinkdropEscrowNetworkToken is Ownable, EIP712 {

    //// EVENTS ////

    event Deposit(
                  address indexed sender,
                  address transferId,
                  uint128 amount,
                  uint128 fee,
                  uint128 expiration
    );

    event Redeem(
                 address indexed sender,
                 address indexed receiver,
                 address transferId,
                 uint128 amount
    );

    event Cancel(
                 address indexed sender,
                 address indexed transferId,
                 uint128 amount
    );

    event Refund(
                 address indexed sender,
                 address indexed transferId,
                 uint128 amount
    );

    event UpdateFees(
                     uint128 claimFee,
                     uint128 depositFee
    );
  
    event UpdateRelayer(
                        address relayer,
                        bool active
    );

    event WithdrawFees(
                        address feeReceiver,
                        uint256 amount
    );
  
    //// STORAGE ////
    address public constant token = address(0); // token address hardcoded as 0 for native tokens (ETH/MATIC/etc)

    struct DepositData {
        uint128 amount;
        uint128 expiration;
    }    
        mapping(address => mapping(address => DepositData)) public deposits; // sender => transferId => amount


    uint128 public claimFee; // in atomic values
    uint128 public depositFee; // in atomic values  
    uint256 public accruedFees;
    mapping(address => bool) public relayers;

    //// MODIFIERS ////

    modifier onlyRelayer {
        require(relayers[msg.sender], "LinkdropEscrow: msg.sender is not relayer.");
        _;
    }

    //// CONSTRUCTOR ////

    constructor(
                address relayer_,
                uint128 claimFee_
    ) EIP712() {
        relayers[relayer_] = true;
        claimFee = claimFee_;
    }

    //// PUBLIC FUNCTIONS ////
    function deposit( 
                     address transferId_,
                     uint128 expiration_
    ) public payable {
        _deposit(msg.sender, transferId_, uint128(msg.value), expiration_);
    }

    function cancel(
                    address transferId_
    ) public {
        uint128 amount_ = deposits[msg.sender][transferId_].amount;

        delete deposits[msg.sender][transferId_];

        payable(msg.sender).transfer(amount_);
        emit Cancel(msg.sender, transferId_, amount_);
    }

    function getDeposit(                      
                        address sender_,
                        address transferId_
    ) public view returns (
                           address tokenAddress,
                           uint128 amount,
                           uint128 expiration
    ) {
        return (address(token), deposits[sender_][transferId_].amount, deposits[sender_][transferId_].expiration);
    }

    // @return uint256 depositFee, uint256 claimFee, uint256 totalFee
    function getFees() public view returns (uint128, uint128, uint128) {
        return (0, claimFee, claimFee);
    }    

    function recoverLinkKeyId(
                              address receiver_,
                              bytes calldata receiverSig_) public pure returns (address linkKeyId) {
        bytes32 prefixedHash_ = ECDSA.toEthSignedMessageHash(keccak256(abi.encodePacked(receiver_)));
        return ECDSA.recover(prefixedHash_, receiverSig_);    
    }

    function recoverSender(
                           address linkKeyId_,
                           address transferId_,
                           bytes calldata senderSig_) public view returns (address sender) {
        // senderHash_ - hash that should have been signed by the sender of the transfer
        bytes32 senderHash_ = EIP712._hashTransfer(
                                                   linkKeyId_,
                                                   transferId_
        );
        return ECDSA.recover(senderHash_, senderSig_);
    }
      
  //// ONLY RELAYER ////
  /**
   * @dev redeem via original claim link, where Link Key was generated by the sender on original deposit. In this case transferID is the address corresponding to Link Key. 
   */
    function redeem(
                    address receiver_,
                    address sender_,                  
                    bytes calldata receiverSig_,
                    bool sponsored_
    ) public onlyRelayer {
        address transferId_ = recoverLinkKeyId(receiver_, receiverSig_);
        _redeem(sender_, transferId_, receiver_, sponsored_);
    }

  /**
   * @dev redeem via recovered claim link. If sender lost the original claim link and Link Key, they can generate new claim link that has a new Link Key. In this case, new Link Key ID should be signed by Sender private key and the escrow contract ensures that the new Link Key was authorized by Sender by verifying Sender Signature.
   */  
    function redeemRecovered(
                             address receiver_,
                             address transferId_,
                             bytes calldata receiverSig_,
                             bytes calldata senderSig_,
                             bool sponsored_
    ) public onlyRelayer {
      
        address linkKeyId_ = recoverLinkKeyId(receiver_, receiverSig_);
        address sender_ = recoverSender(
                                        linkKeyId_,
                                        transferId_,
                                        senderSig_);
      
        _redeem(sender_, transferId_, receiver_, sponsored_);
    }
  
    function _redeem(address sender_, address transferId_, address receiver_, bool sponsored_) private {
        DepositData memory deposit_ = deposits[sender_][transferId_];
        uint128 amount_ = deposit_.amount;
        require(amount_ > 0, "LinkdropEscrow: invalid redeem params");
        require(block.timestamp < deposit_.expiration, "LinkdropEscrow: transfer expired.");

        // accrue fees
        if (!sponsored_) {
            require(amount_ > claimFee, "LinkdropEscrow: invalid redeem params");          
            amount_ -= claimFee;
            accruedFees += uint256(claimFee);
        }        
        
        delete deposits[sender_][transferId_];

        //Transfer network tokens (ETH/MATIC) to receiver_
        payable(receiver_).transfer(uint256(amount_));
            
        emit Redeem(sender_, receiver_, transferId_, amount_);
    }

    function refund(
                    address sender_,            
                    address transferId_,
                    bool sponsored_
    ) public onlyRelayer {
        DepositData memory deposit_ = deposits[sender_][transferId_];
        uint128 amount_ = deposit_.amount;
        require(amount_ > 0, "LinkdropEscrow: invalid transfer ID");        
        require(block.timestamp >= deposit_.expiration, "LinkdropEscrow: transfer not expired yet.");

        // accrue fees
        if (!sponsored_) {
            require(amount_ > claimFee, "LinkdropEscrow: invalid redeem params");          
            amount_ -= claimFee;
            accruedFees += uint256(claimFee);
        }        
        
        delete deposits[sender_][transferId_];
        
        payable(sender_).transfer(uint256(amount_));
        emit Refund(sender_, transferId_, amount_);
    }
    
    //// ONLY OWNER ////
    function withdrawAccruedFees() public onlyOwner {
        uint256 amount_ = accruedFees;
        accruedFees = 0;
        payable(msg.sender).transfer(amount_);
        emit WithdrawFees(msg.sender, amount_);
    }   
    
    function setFees(
                     uint128 claimFee_
    ) public onlyOwner {
        claimFee = claimFee_;
        emit UpdateFees(claimFee, 0);
    }

    function setRelayer(
                        address relayer_,
                        bool active_
    ) public onlyOwner {
        relayers[relayer_] = active_;
        emit UpdateRelayer(relayer_, active_);
    }


    //// INTERNAL FUNCTIONS ////

    /**
     * @dev _deposit handles deposits and fee distribution
     */
    function _deposit(
                      address sender_,
                      address transferId_,
                      uint128 amount_,
                      uint128 expiration_ 
    ) private {
        require(deposits[sender_][transferId_].amount == 0, "LinkdropEscrow: transferId is in use.");
        require(amount_ > claimFee, "LinkdropEscrow: amount is less than total fees."); 
        require(expiration_ > block.timestamp, "LinkdropEscrow: depositing with invalid expiration.");
        
        deposits[sender_][transferId_] = DepositData({
            amount: uint128(amount_),
            expiration: expiration_
            });

        // logging deposit fee despite it's always 0 for consistency with the escrow contracts for other tokens where deposit fee can be present (e.g. USDC deposit with authorization) 
        emit Deposit(sender_, transferId_, amount_, 0, expiration_);
    }
}

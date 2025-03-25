// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;
import "openzeppelin-solidity/contracts/access/Ownable.sol";
import "openzeppelin-solidity/contracts/utils/cryptography/ECDSA.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC721/IERC721.sol";
import "openzeppelin-solidity/contracts/token/ERC1155/IERC1155.sol";
import "openzeppelin-solidity/contracts/security/ReentrancyGuard.sol";
import "openzeppelin-solidity/contracts/security/ReentrancyGuard.sol";
import "openzeppelin-solidity/contracts/utils/cryptography/SignatureChecker.sol";
import "./libraries/EIP712.sol";
import "./libraries/TransferHelper.sol";

abstract contract LinkdropEscrowCommon is EIP712, Ownable, ReentrancyGuard {
    
    //// EVENTS ////
    event Deposit(
                  address indexed sender,
                  address indexed token,
                  address transferId,
                  uint120 expiration,
                  uint8 tokenType,                  
                  uint256 tokenId,
                  uint128 amount,
                  address feeToken,
                  uint128 fee
    );

    event Redeem(               
                 address indexed sender,
                 address indexed token,               
                 address indexed receiver,
                 address transferId,
                 uint8 tokenType,                 
                 uint256 tokenId,
                 uint128 amount
    );

    event Cancel(
                 address indexed sender,
                 address indexed token,
                 address transferId,
                 uint8 tokenType,                 
                 uint256 tokenId,
                 uint128 amount
    );

    event Refund(
                 address indexed sender,
                 address indexed token,
                 address transferId,
                 uint8 tokenType,
                 uint256 tokenId,
                 uint128 amount
    );

    event UpdateFees(
                     uint128 claimFee,
                     uint128 depositFee
    );


    event SenderMessage(address indexed sender, address indexed transferId, bytes senderMessage);
    
    struct DepositData {
        uint256 tokenId;        
        uint128 amount;                
        uint120 expiration;
        uint8 tokenType; // 0 - native, 1 - ERC20, 2 - ERC721, 3 - ERC1155
    }    
        mapping(address => mapping(address => mapping(address => DepositData))) public deposits; // sender => token => transferId => DepositData
    
    event UpdateRelayer(
                        address relayer,
                        bool active
    );

    event WithdrawFees(
                       address feeReceiver,
                       address token_,
                       uint256 amount
    );      
    mapping(address => uint256) public accruedFees; // token -> accrued fees
    mapping(address => bool) public relayers;

    //// MODIFIERS ////

    modifier onlyRelayer {
        require(relayers[msg.sender], "LinkdropEscrow: msg.sender is not relayer.");
        _;
    }


    // log optional encrypted message
    function _logSenderMessage(address sender_, address transferId_, bytes calldata senderMessage_) internal {
        if (senderMessage_.length > 0) { // only log if message was passed
            emit SenderMessage(sender_, transferId_, senderMessage_);
        }
    }    

    function getDeposit(
                        address token_,
                        address sender_,
                        address transferId_
    ) public view returns (
                           address token,
                           uint8 tokenType,
                           uint256 tokenId,
                           uint128 amount,
                           uint120 expiration
    ) {
        DepositData memory deposit_ = deposits[sender_][token_][transferId_];
        return (
                token_,
                deposit_.tokenType,
                deposit_.tokenId,
                deposit_.amount,
                deposit_.expiration);
    }

    
    function verifyFeeAuthorization(
                                    address sender_,
                                    address token_,
                                    address transferId_,
                                    uint256 tokenId_,
                                    uint128 amount_,
                                    uint120 expiration_,
                                    address feeToken_,
                                    uint128 feeAmount_,
                                    bytes calldata feeAuthorization_)
        public view returns (bool isValid) {
        bytes32 prefixedHash_ = ECDSA.toEthSignedMessageHash(keccak256(abi.encodePacked(
                                                                                        sender_,
                                                                                        token_,
                                                                                        transferId_,
                                                                                        tokenId_,
                                                                                        amount_,
                                                                                        expiration_,
                                                                                        feeToken_,
                                                                                        feeAmount_)));
        address signer = ECDSA.recover(prefixedHash_, feeAuthorization_);
        return relayers[signer];
    }

    
    function recoverLinkKeyId(
                              address receiver_,
                              bytes calldata receiverSig_) private pure returns (address linkKeyId) {
        bytes32 prefixedHash_ = ECDSA.toEthSignedMessageHash(keccak256(abi.encodePacked(receiver_)));
        return ECDSA.recover(prefixedHash_, receiverSig_);    
    }


    function isSenderSignatureValid(
                                    address sender_, 
                                    address linkKeyId_,
                                    address transferId_,
                                    bytes calldata senderSig_) private view returns (bool isValid) {
        // senderHash_ - hash that should have been signed by the sender of the transfer
        bytes32 senderHash_ = EIP712._hashTransfer(
                                                   linkKeyId_,
                                                   transferId_
        );
        return SignatureChecker.isValidSignatureNow(sender_, senderHash_, senderSig_);
    }

    function _transferTokens(address token_, address to_, uint8 tokenType_, uint256 tokenId_, uint256 amount_) internal {
        require(tokenType_ < 4, "LinkdropEscrow: unknown token type");        
        if (tokenType_ == 0) { // ETH
            require(token_ == address(0), "LinkdropEscrow: address should be 0 for ETH transfers");
            return TransferHelper.safeTransferETH(to_, amount_);
        }

        require(token_ != address(0), "LinkdropEscrow: token address not provided to make transfer");
        if (tokenType_ == 1) { 
            return TransferHelper.safeTransfer(token_, to_, amount_);
        }
        if (tokenType_ == 2) {             
            return IERC721(token_).safeTransferFrom(address(this), to_, tokenId_);            
        }
        if (tokenType_ == 3) {             
            return IERC1155(token_).safeTransferFrom(address(this), to_, tokenId_, amount_, new bytes(0));            
        }                
    }

    function cancel(
                    address token_,
                    address transferId_
    ) public nonReentrant {

        DepositData memory deposit_ = deposits[msg.sender][token_][transferId_];
        uint128 amount_ = deposit_.amount;
        uint8 tokenType_ = deposit_.tokenType;
        uint256 tokenId_ = deposit_.tokenId;

        require(amount_ > 0, "LinkdropEscrow: Deposit not found");
        delete deposits[msg.sender][token_][transferId_];

        _transferTokens(token_, msg.sender, tokenType_, tokenId_, amount_);
        emit Cancel(msg.sender, token_, transferId_, tokenType_, tokenId_, amount_);
    }

        /**
     * @dev redeem via original claim link, where Link Key was generated by the sender on original deposit. In this case transferID is the address corresponding to Link Key. 
     */
    function redeem(
                    address receiver_,
                    address sender_,
                    address token_,
                    bytes calldata receiverSig_
    ) public onlyRelayer {

        address transferId_ = recoverLinkKeyId(receiver_, receiverSig_);
        _redeem(sender_, token_, transferId_, receiver_);
    }

    /**
     * @dev redeem via recovered claim link. If sender lost the original claim link and Link Key, they can generate new claim link that has a new Link Key. In this case, new Link Key ID should be signed by Sender private key and the escrow contract ensures that the new Link Key was authorized by Sender by verifying Sender Signature.
     */  
    function redeemRecovered(
                             address receiver_,
                             address sender_,
                             address token_,
                             address transferId_,
                             bytes calldata receiverSig_,
                             bytes calldata senderSig_
    ) public onlyRelayer {
      
        address linkKeyId_ = recoverLinkKeyId(receiver_, receiverSig_);
        bool isSenderSigValid = isSenderSignatureValid(
                                                       sender_,
                                                       linkKeyId_,
                                                       transferId_,
                                                       senderSig_);
        require(isSenderSigValid, "LinkdropEscrow: invalid sender signature");
        
        _redeem(sender_, token_, transferId_, receiver_);
    }
  
    function _redeem(address sender_, address token_, address transferId_, address receiver_) private {
        DepositData memory deposit_ = deposits[sender_][token_][transferId_];
        uint128 amount_ = deposit_.amount;
        uint8 tokenType_ = deposit_.tokenType;
        uint256 tokenId_ = deposit_.tokenId;

        require(amount_ > 0, "LinkdropEscrow: invalid redeem params");
        require(block.timestamp < deposit_.expiration, "LinkdropEscrow: transfer expired.");
     
        delete deposits[sender_][token_][transferId_];

        _transferTokens(token_, receiver_, tokenType_, tokenId_, amount_);
        emit Redeem(sender_, token_, receiver_, transferId_, tokenType_, tokenId_, amount_);
    }

    function refund(
                    address sender_,
                    address token_,
                    address transferId_
    ) public onlyRelayer {
        DepositData memory deposit_ = deposits[sender_][token_][transferId_];
        uint128 amount_ = deposit_.amount;
        uint8 tokenType_ = deposit_.tokenType;
        uint256 tokenId_ = deposit_.tokenId;
        require(amount_ > 0, "LinkdropEscrow: invalid transfer ID");
        delete deposits[sender_][token_][transferId_];
    
        _transferTokens(token_, sender_, tokenType_, tokenId_, amount_);
        emit Refund(sender_, token_, transferId_, tokenType_, tokenId_, amount_);
    }


    function _makeDeposit(
                          address sender_,
                          address token_,
                          address transferId_,
                          uint256 tokenId_,
                          uint128 amount_,
                          uint120 expiration_,
                          uint8 tokenType_,
                          address feeToken_,
                          uint128 feeAmount_) internal {
        deposits[sender_][token_][transferId_] = DepositData({
            tokenId: tokenId_,
            amount: amount_,
            expiration: expiration_,
            tokenType: tokenType_
            });

        // accrue fees
        accruedFees[feeToken_] += uint256(feeAmount_);        
        
        emit Deposit(sender_, token_, transferId_, expiration_, tokenType_, tokenId_, amount_, feeToken_, feeAmount_);
    }
    
    //// ONLY OWNER ////  
    function setRelayer(
                        address relayer_,
                        bool active_
    ) public onlyOwner {
        relayers[relayer_] = active_;
        emit UpdateRelayer(relayer_, active_);
    }

    function withdrawAccruedFees(address token_) public onlyOwner {
        uint256 amount_ = accruedFees[token_];
        accruedFees[token_] = 0;
        uint8 tokenType_ = 0;
        if (token_ != address(0)) {
            tokenType_ = 1;
        }
        _transferTokens(token_, msg.sender, tokenType_, 0 /*tokenId*/, amount_);
        emit WithdrawFees(msg.sender, token_, amount_);
    }
}

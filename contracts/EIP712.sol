// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

contract EIP712 {
    bytes32 public constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    
    // Domain
    struct EIP712Domain {
        string name;
        string version;
        uint256 chainId;
        address verifyingContract;
    }
    EIP712Domain public domain;
    bytes32 public immutable _DOMAIN_SEPARATOR;
    bytes32 public constant _TRANSFER_TYPE_HASH = keccak256(
        "Transfer(address linkKeyId,address transferId)"
    );
    /* bytes32 public constant _TRANSFER_TYPE_HASH = 0x9b18bc06d5328d5d5bebd4ac448e2311930b26245b52c1dd5c65c534feaba064; */

    constructor(){
      uint256 chainId;
        assembly {
            chainId := chainid()
        }
        domain = EIP712Domain({
            name: "LinkdropEscrow",
            version: "2",
            chainId: chainId,
            verifyingContract: address(this)
        });
        _DOMAIN_SEPARATOR = keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH,
                                                 keccak256(bytes(domain.name)),
                                                 keccak256(bytes(domain.version)),
                                                 domain.chainId,
                                                 address(this)
                                                 ));
        require(_TRANSFER_TYPE_HASH == keccak256( 
                                                 "Transfer(address linkKeyId,address transferId)"
                                                  ), "EIP712: invalid type hash");
                
    }
    
    function _hashTransfer(
                           address linkKeyId_,
                           address transferId_
    ) internal view returns (bytes32) {
        bytes32 transferHash = keccak256(
            abi.encode(
                _TRANSFER_TYPE_HASH,
                linkKeyId_,
                transferId_
            )
        );

        return keccak256(
            abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, transferHash)
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "openzeppelin-solidity/contracts/token/ERC721/ERC721.sol";

contract ERC721Mock is ERC721 {
    uint256 public tokenCount = 0;

    constructor() public ERC721("LinkdropMockERC721", "LMT") {
    }

    
    function safeMint(address to) public {
        ++tokenCount;     
        _safeMint(to, tokenCount); 
    }
}

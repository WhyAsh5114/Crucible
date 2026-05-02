// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DemoVault {
    address public owner;
    address public pendingOwner;
    uint64 public constant COOLDOWN = 60;
    uint64 public lastWithdrawAt;
    mapping(address => uint256) public balances;

    event Deposited(address indexed by, uint256 amount, uint256 vaultBalance);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == pendingOwner, "DemoVault: caller is not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        lastWithdrawAt = uint64(block.timestamp);
    }

    function deposit() external payable {
        require(msg.value > 0, "DemoVault: zero deposit");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value, address(this).balance);
    }

    function withdraw(uint256 amount) external onlyOwner {
        require(amount > 0, "DemoVault: zero amount");
        require(address(this).balance >= amount, "DemoVault: insufficient balance");
        require(uint64(block.timestamp) >= lastWithdrawAt + COOLDOWN, "DemoVault: cooldown not elapsed");
        lastWithdrawAt = uint64(block.timestamp);
        (bool ok, ) = owner.call{ value: amount }("");
        require(ok, "DemoVault: ETH transfer failed");
        emit Withdrawn(owner, amount);
    }

    receive() external payable {
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value, address(this).balance);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title Counter
/// @notice Minimal stateful contract used as a compilation fixture.
contract Counter {
    uint256 public count;

    event Incremented(uint256 newCount);
    event Decremented(uint256 newCount);
    event Reset();

    function increment() external {
        count += 1;
        emit Incremented(count);
    }

    function decrement() external {
        require(count > 0, "Counter: already zero");
        count -= 1;
        emit Decremented(count);
    }

    function reset() external {
        count = 0;
        emit Reset();
    }
}

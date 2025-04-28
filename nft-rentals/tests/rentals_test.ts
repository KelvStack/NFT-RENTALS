import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

// Test rental creation
Clarinet.test({
    name: "Ensure that contract owner can create a rental",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;

        const tokenId = 123;
        const duration = 100;
        const price = 1000000; // 1 STX

        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(tokenId),
                    types.uint(duration),
                    types.uint(price)
                ],
                deployer.address
            )
        ]);

        // Check successful response - should return the rental ID (0)
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok u0)');

        // Check that NFT was minted
        assertEquals(block.receipts[0].events[0].type, 'nft_mint');

        // Check rental details
        const call = chain.callReadOnlyFn(
            'nft-rental',
            'get-rental',
            [types.uint(0)],
            deployer.address
        );

        const result = call.result.replace(/\s+/g, ' ').trim();
        assertEquals(
            result.includes(`{owner: ${deployer.address}, renter: none, token-id: u${tokenId}, rental-start: u0, rental-end: u0, price: u${price}}`),
            true
        );

        // Check token-rental mapping
        const tokenRental = chain.callReadOnlyFn(
            'nft-rental',
            'get-token-rental',
            [types.uint(tokenId)],
            deployer.address
        );

        assertEquals(tokenRental.result, '(some u0)');
    },
});

// Test rental creation by non-owner
Clarinet.test({
    name: "Ensure that non-owners cannot create rentals",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const user1 = accounts.get('wallet_1')!;

        const tokenId = 123;
        const duration = 100;
        const price = 1000000; // 1 STX

        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(tokenId),
                    types.uint(duration),
                    types.uint(price)
                ],
                user1.address
            )
        ]);

        // Check for owner-only error
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u100)'); // err-owner-only
    },
});

// Test renting an NFT
Clarinet.test({
    name: "Ensure that users can rent available NFTs",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        const tokenId = 123;
        const duration = 100;
        const price = 1000000; // 1 STX

        // First create a rental
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(tokenId),
                    types.uint(duration),
                    types.uint(price)
                ],
                deployer.address
            )
        ]);

        // Now rent it
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)], // rental ID 0
                renter.address
            )
        ]);

        // Check successful rental
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify STX transfer event
        assertEquals(block.receipts[0].events[0].type, 'stx_transfer');
        assertEquals(block.receipts[0].events[0].stx_transfer.amount, price.toString());
        assertEquals(block.receipts[0].events[0].stx_transfer.recipient, deployer.address);
        assertEquals(block.receipts[0].events[0].stx_transfer.sender, renter.address);

        // Check updated rental details
        const call = chain.callReadOnlyFn(
            'nft-rental',
            'get-rental',
            [types.uint(0)],
            deployer.address
        );

        const result = call.result.replace(/\s+/g, ' ').trim();
        assertEquals(result.includes(`renter: (some ${renter.address})`), true);
        assertEquals(result.includes(`rental-start: u2`), true); // Block height 2
    },
});

// Test renting already rented NFT
Clarinet.test({
    name: "Ensure that already rented NFTs cannot be rented again",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter1 = accounts.get('wallet_1')!;
        const renter2 = accounts.get('wallet_2')!;

        // First create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter1.address
            )
        ]);

        // Try to rent it again
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter2.address
            )
        ]);

        // Check error response
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u103)'); // err-already-rented
    },
});

// Test canceling an available rental
Clarinet.test({
    name: "Ensure that owners can cancel available (not rented) rentals",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;

        // Create a rental
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            )
        ]);

        // Cancel it
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'cancel-rental',
                [types.uint(0)],
                deployer.address
            )
        ]);

        // Check successful cancellation
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify NFT burn event
        assertEquals(block.receipts[0].events[0].type, 'nft_burn');

        // Check rental is deleted
        const call = chain.callReadOnlyFn(
            'nft-rental',
            'get-rental',
            [types.uint(0)],
            deployer.address
        );

        assertEquals(call.result, 'none');

        // Check token-rental mapping is deleted
        const tokenRental = chain.callReadOnlyFn(
            'nft-rental',
            'get-token-rental',
            [types.uint(123)],
            deployer.address
        );

        assertEquals(tokenRental.result, 'none');
    },
});

// Test canceling a rented NFT
Clarinet.test({
    name: "Ensure that rented NFTs cannot be canceled",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        // Create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // Try to cancel it
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'cancel-rental',
                [types.uint(0)],
                deployer.address
            )
        ]);

        // Check error response
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u103)'); // err-already-rented
    },
});

// Test extending a rental
Clarinet.test({
    name: "Ensure that renters can extend their rental",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        const tokenId = 123;
        const duration = 100;
        const price = 1000000; // 1 STX
        const additionalBlocks = 50;

        // Create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(tokenId),
                    types.uint(duration),
                    types.uint(price)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // Extend the rental
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'extend-rental',
                [
                    types.uint(0),
                    types.uint(additionalBlocks)
                ],
                renter.address
            )
        ]);

        // Check successful extension
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify updated rental period
        const call = chain.callReadOnlyFn(
            'nft-rental',
            'get-rental',
            [types.uint(0)],
            deployer.address
        );

        // The actual implementation updates rental-end, so check it has increased
        const result = call.result;
        assertEquals(result.includes(`rental-end: u${duration + additionalBlocks}`), true);
    },
});

// Test extending a rental beyond max allowed blocks
Clarinet.test({
    name: "Ensure that rental extensions beyond maximum limits are rejected",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        const maxExtension = 1000; // From contract constant

        // Create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // Try to extend beyond max
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'extend-rental',
                [
                    types.uint(0),
                    types.uint(maxExtension + 1) // Beyond max
                ],
                renter.address
            )
        ]);

        // Check error response
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u107)'); // err-invalid-extension
    },
});

// Test filing a rental dispute
Clarinet.test({
    name: "Ensure that parties can file rental disputes",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        // Create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // File a dispute as renter
        const disputeReason = "Item not as described";
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'file-rental-dispute',
                [
                    types.uint(0),
                    types.utf8(disputeReason)
                ],
                renter.address
            )
        ]);

        // Check successful dispute filing
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');
    },
});

// Test filing dispute by non-participant
Clarinet.test({
    name: "Ensure that only rental participants can file disputes",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;
        const thirdParty = accounts.get('wallet_2')!;

        // Create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // Try to file a dispute as a third party
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'file-rental-dispute',
                [
                    types.uint(0),
                    types.utf8("Invalid dispute")
                ],
                thirdParty.address
            )
        ]);

        // Check error response
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u100)'); // err-owner-only
    },
});

// Test collecting marketplace fee
Clarinet.test({
    name: "Ensure that contract owner can collect marketplace fees",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        const price = 1000000; // 1 STX
        const feeBps = 250; // 2.5%
        const expectedFee = (price * feeBps) / 10000; // 25000 uSTX

        // Create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(price)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // Collect marketplace fee
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'collect-marketplace-fee',
                [types.uint(0)],
                deployer.address
            )
        ]);

        // Check successful fee collection
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, `(ok u${expectedFee})`);
    },
});

// Test rating a rental as renter
Clarinet.test({
    name: "Ensure that renters can rate rentals",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        // Create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // Rate the rental as renter
        const rating = 5;
        const review = "Great NFT, very helpful owner!";
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'rate-rental',
                [
                    types.uint(0),
                    types.bool(true), // is-renter
                    types.uint(rating),
                    types.some(types.utf8(review))
                ],
                renter.address
            )
        ]);

        // Check successful rating
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');
    },
});

// Test rating a rental as owner
Clarinet.test({
    name: "Ensure that owners can rate rentals",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        // Create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // Rate the rental as owner
        const rating = 4;
        const review = "Good renter, took care of the NFT.";
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'rate-rental',
                [
                    types.uint(0),
                    types.bool(false), // not is-renter (i.e., owner)
                    types.uint(rating),
                    types.some(types.utf8(review))
                ],
                deployer.address
            )
        ]);

        // Check successful rating
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');
    },
});

// Test rating with invalid score
Clarinet.test({
    name: "Ensure that invalid rating scores are rejected",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        // Create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // Try to rate with invalid scores
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'rate-rental',
                [
                    types.uint(0),
                    types.bool(true),
                    types.uint(0), // Too low
                    types.none()
                ],
                renter.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rate-rental',
                [
                    types.uint(0),
                    types.bool(true),
                    types.uint(6), // Too high
                    types.none()
                ],
                renter.address
            )
        ]);

        // Check error responses
        assertEquals(block.receipts.length, 2);
        assertEquals(block.receipts[0].result, '(err u107)'); // err-invalid-extension
        assertEquals(block.receipts[1].result, '(err u107)'); // err-invalid-extension
    },
});

// Test rating by non-participant
Clarinet.test({
    name: "Ensure that only rental participants can rate",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;
        const thirdParty = accounts.get('wallet_2')!;

        // Create and rent an NFT
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // Try to rate as a third party
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'rate-rental',
                [
                    types.uint(0),
                    types.bool(true), // Pretending to be renter
                    types.uint(5),
                    types.none()
                ],
                thirdParty.address
            )
        ]);

        // Check error response
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u100)'); // err-owner-only
    },
});

// Test end of rental
Clarinet.test({
    name: "Ensure that expired rentals can be ended",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        // Create and rent an NFT with short duration
        const duration = 5; // Very short rental
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(duration),
                    types.uint(1000000)
                ],
                deployer.address
            ),
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                renter.address
            )
        ]);

        // Mine enough blocks to expire the rental
        for (let i = 0; i < duration + 1; i++)
        {
            chain.mineBlock([]);
        }

        // End the rental
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'end-rental',
                [types.uint(0)],
                deployer.address // Anyone can call this if rental is expired
            )
        ]);

        // Check successful ending
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify NFT transfer event
        assertEquals(block.receipts[0].events[0].type, 'nft_transfer');

        // Check rental is deleted
        const call = chain.callReadOnlyFn(
            'nft-rental',
            'get-rental',
            [types.uint(0)],
            deployer.address
        );

        assertEquals(call.result, 'none');
    },
});

// Test comprehensive rental lifecycle
Clarinet.test({
    name: "Test complete rental lifecycle including extensions and ratings",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const renter = accounts.get('wallet_1')!;

        const tokenId = 123;
        const duration = 10;
        const price = 1000000; // 1 STX
        const additionalBlocks = 5;

        // Step 1: Create rental
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(tokenId),
                    types.uint(duration),
                    types.uint(price)
                ],
                deployer.address
            )
        ]);

        const rentalId = 0; // First rental

        // Step 2: Rent the NFT
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(rentalId)],
                renter.address
            )
        ]);

        // Step 3: Extend the rental
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'extend-rental',
                [
                    types.uint(rentalId),
                    types.uint(additionalBlocks)
                ],
                renter.address
            )
        ]);

        // Step 4: Rate the rental from both sides
        block = chain.mineBlock([
            // Renter rates
            Tx.contractCall(
                'nft-rental',
                'rate-rental',
                [
                    types.uint(rentalId),
                    types.bool(true), // is-renter
                    types.uint(5),
                    types.some(types.utf8("Great NFT, enjoyed renting it!"))
                ],
                renter.address
            ),
            // Owner rates
            Tx.contractCall(
                'nft-rental',
                'rate-rental',
                [
                    types.uint(rentalId),
                    types.bool(false), // is-owner
                    types.uint(4),
                    types.some(types.utf8("Good renter, returned on time."))
                ],
                deployer.address
            )
        ]);

        // Step 5: Mine enough blocks for rental to expire
        for (let i = 0; i < duration + additionalBlocks + 1; i++)
        {
            chain.mineBlock([]);
        }

        // Step 6: End the rental
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'end-rental',
                [types.uint(rentalId)],
                deployer.address
            )
        ]);

        // Check successful ending
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Step 7: Verify rental is deleted
        const call = chain.callReadOnlyFn(
            'nft-rental',
            'get-rental',
            [types.uint(rentalId)],
            deployer.address
        );

        assertEquals(call.result, 'none');
    },
});

// Test error handling for various scenarios
Clarinet.test({
    name: "Test error handling in various edge cases",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!;
        const user2 = accounts.get('wallet_2')!;

        // Create a rental first
        let block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000)
                ],
                deployer.address
            )
        ]);

        // Test Scenario 1: Try to get non-existent rental
        let call = chain.callReadOnlyFn(
            'nft-rental',
            'get-rental',
            [types.uint(999)], // Non-existent rental ID
            deployer.address
        );

        assertEquals(call.result, 'none');

        // Test Scenario 2: Try to end a rental that's not rented yet
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'end-rental',
                [types.uint(0)], // Not rented yet
                deployer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u104)'); // err-not-rented

        // Test Scenario 3: Non-owner tries to cancel rental
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'cancel-rental',
                [types.uint(0)],
                user1.address // Not the owner
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u101)'); // err-not-token-owner

        // Test Scenario 4: Try to extend a rental that doesn't exist
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'extend-rental',
                [
                    types.uint(999), // Non-existent rental
                    types.uint(50)
                ],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u102)'); // err-token-not-found

        // Test Scenario 5: Rent the NFT and then try extension by someone who's not the renter
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                user1.address
            ),
            Tx.contractCall(
                'nft-rental',
                'extend-rental',
                [
                    types.uint(0),
                    types.uint(50)
                ],
                user2.address // Not the renter
            )
        ]);

        assertEquals(block.receipts.length, 2);
        assertEquals(block.receipts[0].result, '(ok true)');
        assertEquals(block.receipts[1].result, '(err u106)'); // err-cannot-extend

        // Test Scenario 6: Try to collect marketplace fee as non-owner
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'collect-marketplace-fee',
                [types.uint(0)],
                user1.address // Not contract owner
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u100)'); // err-owner-only

        // Test Scenario 7: Attempt to end a rental before it expires
        block = chain.mineBlock([
            Tx.contractCall(
                'nft-rental',
                'end-rental',
                [types.uint(0)],
                deployer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u105)'); // err-rental-expired
    },
});

// Test simultaneous operations with multiple rentals
Clarinet.test({
    name: "Test multiple rentals and operations simultaneously",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!;
        const user2 = accounts.get('wallet_2')!;

        // Create multiple rentals
        let block = chain.mineBlock([
            // Create first rental
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(123),
                    types.uint(100),
                    types.uint(1000000) // 1 STX
                ],
                deployer.address
            ),
            // Create second rental
            Tx.contractCall(
                'nft-rental',
                'create-rental',
                [
                    types.uint(456),
                    types.uint(200),
                    types.uint(2000000) // 2 STX
                ],
                deployer.address
            )
        ]);

        // Both rentals should be created successfully
        assertEquals(block.receipts.length, 2);
        assertEquals(block.receipts[0].result, '(ok u0)');
        assertEquals(block.receipts[1].result, '(ok u1)');

        // Rent both NFTs by different users
        block = chain.mineBlock([
            // User1 rents first NFT
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(0)],
                user1.address
            ),
            // User2 rents second NFT
            Tx.contractCall(
                'nft-rental',
                'rent-nft',
                [types.uint(1)],
                user2.address
            )
        ]);

        // Both rentals should succeed
        assertEquals(block.receipts.length, 2);
        assertEquals(block.receipts[0].result, '(ok true)');
        assertEquals(block.receipts[1].result, '(ok true)');

        // Perform mixed operations on both rentals
        block = chain.mineBlock([
            // User1 extends their rental
            Tx.contractCall(
                'nft-rental',
                'extend-rental',
                [
                    types.uint(0),
                    types.uint(50)
                ],
                user1.address
            ),
            // User1 rates their rental
            Tx.contractCall(
                'nft-rental',
                'rate-rental',
                [
                    types.uint(0),
                    types.bool(true), // is-renter
                    types.uint(5),
                    types.some(types.utf8("Great first NFT!"))
                ],
                user1.address
            ),
            // User2 files a dispute on their rental
            Tx.contractCall(
                'nft-rental',
                'file-rental-dispute',
                [
                    types.uint(1),
                    types.utf8("Not as expected")
                ],
                user2.address
            ),
            // Owner rates the second rental
            Tx.contractCall(
                'nft-rental',
                'rate-rental',
                [
                    types.uint(1),
                    types.bool(false), // is-owner
                    types.uint(3),
                    types.some(types.utf8("Okay experience with renter"))
                ],
                deployer.address
            )
        ]);

        // All operations should succeed
        assertEquals(block.receipts.length, 4);
        assertEquals(block.receipts[0].result, '(ok true)');
        assertEquals(block.receipts[1].result, '(ok true)');
        assertEquals(block.receipts[2].result, '(ok true)');
        assertEquals(block.receipts[3].result, '(ok true)');
    },
});
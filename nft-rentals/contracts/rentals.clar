;; NFT Rental System

;; Constants
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))
(define-constant err-token-not-found (err u102))
(define-constant err-already-rented (err u103))
(define-constant err-not-rented (err u104))
(define-constant err-rental-expired (err u105))

(define-constant err-cannot-extend (err u106))
(define-constant err-invalid-extension (err u107))
(define-constant max-rental-extension-blocks u1000)

(define-constant marketplace-fee-bps u250) ;; 2.5% fee
(define-constant err-insufficient-funds (err u108))

;; Data Variables
(define-data-var next-rental-id uint u0)

;; Define the NFT
(define-non-fungible-token rented-nft uint)

;; Define Maps
(define-map rentals
  uint
  {
    owner: principal,
    renter: (optional principal),
    token-id: uint,
    rental-start: uint,
    rental-end: uint,
    price: uint
  }
)

(define-map token-rental uint uint)

(define-map rental-disputes
  uint
  {
    rental-id: uint,
    disputer: principal,
    reason: (string-utf8 100),
    status: (string-ascii 20)
  }
)

;; Read-only functions
(define-read-only (get-rental (rental-id uint))
  (map-get? rentals rental-id)
)

(define-read-only (get-token-rental (token-id uint))
  (map-get? token-rental token-id)
)

;; Public functions
(define-public (create-rental (token-id uint) (duration uint) (price uint))
  (let
    (
      (rental-id (var-get next-rental-id))
    )
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (asserts! (is-none (map-get? token-rental token-id)) err-already-rented)
    (try! (nft-mint? rented-nft rental-id tx-sender))
    (map-set rentals
      rental-id
      {
        owner: tx-sender,
        renter: none,
        token-id: token-id,
        rental-start: u0,
        rental-end: u0,
        price: price
      }
    )
    (map-set token-rental token-id rental-id)
    (var-set next-rental-id (+ rental-id u1))
    (ok rental-id)
  )
)

(define-public (rent-nft (rental-id uint))
  (let
    (
      (rental (unwrap! (map-get? rentals rental-id) err-token-not-found))
      (price (get price rental))
    )
    (asserts! (is-none (get renter rental)) err-already-rented)
    (try! (stx-transfer? price tx-sender (get owner rental)))
    (map-set rentals
      rental-id
      (merge rental {
        renter: (some tx-sender),
        rental-start: block-height,
        rental-end: (+ block-height (get rental-end rental))
      })
    )
    (ok true)
  )
)

(define-public (end-rental (rental-id uint))
  (let
    (
      (rental (unwrap! (map-get? rentals rental-id) err-token-not-found))
    )
    (asserts! (is-some (get renter rental)) err-not-rented)
    (asserts! (>= block-height (get rental-end rental)) err-rental-expired)
    (try! (nft-transfer? rented-nft rental-id (get owner rental) (unwrap! (get renter rental) err-not-rented)))
    (map-delete token-rental (get token-id rental))
    (map-delete rentals rental-id)
    (ok true)
  )
)


(define-public (cancel-rental (rental-id uint))
  (let
    (
      (rental (unwrap! (map-get? rentals rental-id) err-token-not-found))
    )
    (asserts! (is-eq tx-sender (get owner rental)) err-not-token-owner)
    (asserts! (is-none (get renter rental)) err-already-rented)
    (try! (nft-burn? rented-nft rental-id tx-sender))
    (map-delete token-rental (get token-id rental))
    (map-delete rentals rental-id)
    (ok true)
  )
)

;; Commit: Implement Rental Extension Feature
(define-public (extend-rental (rental-id uint) (additional-blocks uint))
  (let
    (
      (rental (unwrap! (map-get? rentals rental-id) err-token-not-found))
      (current-renter (unwrap! (get renter rental) err-not-rented))
    )
    ;; Ensure only current renter can extend
    (asserts! (is-eq tx-sender current-renter) err-cannot-extend)
    
    ;; Limit extension to prevent abuse
    (asserts! (<= additional-blocks max-rental-extension-blocks) err-invalid-extension)
    
    ;; Calculate additional cost (could be prorated or at full rental rate)
    (let
      (
        (extension-price (/ (* (get price rental) additional-blocks) (get rental-end rental)))
      )
      ;; Transfer additional funds to owner
      (try! (stx-transfer? extension-price tx-sender (get owner rental)))
      
      ;; Update rental end time
      (map-set rentals
        rental-id
        (merge rental {
          rental-end: (+ (get rental-end rental) additional-blocks)
        })
      )
      
      (ok true)
    )
  )
)

(define-public (file-rental-dispute (rental-id uint) (reason (string-utf8 100)))
  (let
    (
      (rental (unwrap! (map-get? rentals rental-id) err-token-not-found))
    )
    ;; Only renter or owner can file a dispute
    (asserts! 
      (or 
        (is-eq tx-sender (unwrap! (get renter rental) err-not-rented))
        (is-eq tx-sender (get owner rental))
      )
      err-owner-only
    )
    
    (map-set rental-disputes
      rental-id
      {
        rental-id: rental-id,
        disputer: tx-sender,
        reason: reason,
        status: "PENDING"
      }
    )
    
    (ok true)
  )
)

(define-public (collect-marketplace-fee (rental-id uint))
  (let
    (
      (rental (unwrap! (map-get? rentals rental-id) err-token-not-found))
      (rental-price (get price rental))
      (marketplace-fee (/ (* rental-price marketplace-fee-bps) u10000))
    )
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    
    ;; Transfer marketplace fee to contract owner
    (try! (stx-transfer? marketplace-fee tx-sender contract-owner))
    
    (ok marketplace-fee)
  )
)
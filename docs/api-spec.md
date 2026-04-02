# API Specification

This document is curated from the implemented Fastify route tree and the generated OpenAPI output exposed by the backend tooling. All paths below are under `/api/v1` unless noted.

## Conventions

- Auth: JWT in HttpOnly cookie `access_token`
- Common success payloads are JSON unless the endpoint streams CSV
- Common error payload: `{"message":"..."}`
- Role checks are enforced at route level or by service guard

## Health

### `GET /health`
- Auth: none
- Response:
```json
{"status":"ok"}
```

### `GET /api/v1/health`
- Auth: none
- Response:
```json
{"status":"ok","version":"v1"}
```

## Auth

### `POST /api/v1/auth/register`
- Auth: none
- Body:
```json
{"username":"qa.user","password":"SecretPass123!","displayName":"QA User","email":"qa.user@example.com","consentGranted":true}
```
- Response:
```json
{"user":{"id":"usr_1","username":"qa.user","displayName":"QA User","roles":["USER"]}}
```

### `POST /api/v1/auth/login`
- Auth: none
- Body:
```json
{"username":"qa.admin@culinary.local","password":"QaAdminPass123!"}
```
- Response:
```json
{"user":{"id":"usr_1","username":"qa.admin@culinary.local","roles":["ADMIN","USER"]}}
```

### `POST /api/v1/auth/logout`
- Auth: cookie
- Response: `204 No Content`

### `GET /api/v1/auth/me`
- Auth: cookie
- Response:
```json
{"user":{"sub":"usr_1","username":"qa.admin@culinary.local","roles":["ADMIN","USER"]}}
```

### `GET /api/v1/auth/admin/health`
- Auth: cookie + `ADMIN`
- Response:
```json
{"status":"ok"}
```

## Bookings

### `GET /api/v1/bookings/availability?sessionKey=&startAt=&endAt=&capacity=`
- Auth: cookie
- Response:
```json
{"sessionKey":"group.class.demo","startAt":"2026-04-01T18:00:00.000Z","endAt":"2026-04-01T19:00:00.000Z","opensAt":"2026-03-31T18:00:00.000Z","isOpen":true,"capacity":10,"activeBookings":4,"remainingCapacity":6,"isBookableNow":true}
```

### `POST /api/v1/bookings`
- Auth: cookie + signed request + idempotency-key on protected mutation paths
- Body:
```json
{"sessionKey":"group.class.demo","seatKey":"seat-1","startAt":"2026-04-01T18:00:00.000Z","endAt":"2026-04-01T19:00:00.000Z","capacity":10,"partySize":1}
```
- Response:
```json
{"booking":{"id":"bkg_1","sessionKey":"group.class.demo","seatKey":"seat-1","startAt":"2026-04-01T18:00:00.000Z","endAt":"2026-04-01T19:00:00.000Z"}}
```

### `POST /api/v1/bookings/waitlist`
- Auth: cookie + signed request + idempotency-key
- Body:
```json
{"sessionKey":"group.class.demo","startAt":"2026-04-01T18:00:00.000Z","endAt":"2026-04-01T19:00:00.000Z","capacity":10}
```
- Response:
```json
{"alreadyQueued":false,"waitlistEntry":{"id":"wl_1","queuePosition":1,"status":"WAITING"}}
```

### `GET /api/v1/bookings/waitlist?sessionKey=&startAt=&endAt=`
- Auth: cookie
- Response:
```json
{"sessionKey":"group.class.demo","startAt":"2026-04-01T18:00:00.000Z","endAt":"2026-04-01T19:00:00.000Z","entries":[{"id":"wl_1","userId":"usr_2","queuePosition":1,"status":"WAITING","offeredAt":null,"convertedAt":null,"bookingId":null,"createdAt":"2026-03-30T12:00:00.000Z"}]}
```

### `POST /api/v1/bookings/:bookingId/cancel`
- Auth: cookie + signed request + idempotency-key
- Body:
```json
{"capacity":10}
```
- Response:
```json
{"canceledBookingId":"bkg_1","feePreview":{"policyBand":"24h_to_2h","feePercent":50,"feeAmount":20}}
```

### `GET /api/v1/bookings/:bookingId/cancellation-preview?baseAmount=`
- Auth: cookie
- Response:
```json
{"bookingId":"bkg_1","preview":{"policyBand":"24h_to_2h","feePercent":50,"feeAmount":20,"baseAmount":40,"hoursBeforeStart":6,"generatedAt":"2026-03-30T12:00:00.000Z"}}
```

### `POST /api/v1/bookings/:bookingId/cancel-confirm`
- Auth: cookie + signed request + idempotency-key
- Body:
```json
{"capacity":10,"baseAmount":40}
```
- Response:
```json
{"canceledBookingId":"bkg_1","feePreview":{"policyBand":"24h_to_2h","feePercent":50,"feeAmount":20,"baseAmount":40}}
```

### `POST /api/v1/bookings/:bookingId/reschedule`
- Auth: cookie + signed request + idempotency-key
- Body:
```json
{"newSessionKey":"group.class.demo.2","newSeatKey":"seat-3","newStartAt":"2026-04-02T18:00:00.000Z","newEndAt":"2026-04-02T19:00:00.000Z","capacity":10}
```
- Response:
```json
{"booking":{"id":"bkg_1","sessionKey":"group.class.demo.2","seatKey":"seat-3","startAt":"2026-04-02T18:00:00.000Z","endAt":"2026-04-02T19:00:00.000Z"}}
```

### `POST /api/v1/bookings/promote-next`
- Auth: cookie + `ADMIN` + signed request + idempotency-key
- Body:
```json
{"sessionKey":"group.class.demo","seatKey":"seat-1","startAt":"2026-04-01T18:00:00.000Z","endAt":"2026-04-01T19:00:00.000Z","capacity":10}
```
- Response:
```json
{"promoted":true,"waitlistEntryId":"wl_1","booking":{"id":"bkg_2"}}
```

### `POST /api/v1/bookings/:bookingId/reminders`
- Auth: cookie
- Body:
```json
{"remindAt":"2026-03-31T18:00:00.000Z"}
```
- Response:
```json
{"id":"ntf_1","scenario":"CLASS_REMINDER"}
```

## Billing

### `GET /api/v1/billing/price-books/effective?asOf=&currency=`
- Auth: cookie
- Response:
```json
{"id":"pb_1","code":"DEFAULT","version":3,"name":"Default Price Book","currency":"USD","validFrom":"2026-03-01T00:00:00.000Z","validTo":null}
```

### `GET /api/v1/billing/membership-plans/:membershipPlanId/price?asOf=&currency=`
- Auth: cookie
- Response:
```json
{"membershipPlan":{"id":"mp_1","code":"MONTHLY","name":"Monthly Membership"},"priceBook":{"id":"pb_1","code":"DEFAULT","version":3,"currency":"USD"},"priceItem":{"id":"pi_1","unitAmount":79,"taxAmount":7.01}}
```

### `POST /api/v1/billing/memberships/enroll`
- Auth: cookie
- Body:
```json
{"membershipPlanId":"mp_1","startsAt":"2026-04-01T00:00:00.000Z","autoRenew":true}
```
- Response:
```json
{"enrollment":{"id":"enr_1","membershipPlanId":"mp_1","startsAt":"2026-04-01T00:00:00.000Z"}}
```

### `POST /api/v1/billing/memberships/:enrollmentId/renew`
- Auth: cookie
- Body:
```json
{"asOf":"2026-05-01T00:00:00.000Z"}
```

### `GET /api/v1/billing/credit-packs/:creditPackId/price?asOf=&currency=`
- Auth: cookie
- Response:
```json
{"creditPack":{"id":"cp_1","code":"CLASS10","name":"Class 10-Pack"},"priceBook":{"id":"pb_1","code":"DEFAULT","version":3,"currency":"USD"},"priceItem":{"id":"pi_2","unitAmount":120,"taxAmount":10.65}}
```

### `POST /api/v1/billing/credit-packs/purchase`
- Auth: cookie
- Body:
```json
{"creditPackId":"cp_1"}
```

### `GET /api/v1/billing/credits/balance`
- Auth: cookie
- Response:
```json
{"userId":"usr_1","creditsRemaining":12}
```

### `POST /api/v1/billing/credits/consume`
- Auth: cookie
- Body:
```json
{"amount":2,"reason":"Class booking"}
```

### `GET /api/v1/billing/wallet?currency=`
- Auth: cookie
- Response:
```json
{"userId":"usr_1","currency":"USD","balance":42.5}
```

### `POST /api/v1/billing/wallet/top-up`
- Auth: cookie + `ADMIN`
- Body:
```json
{"userId":"usr_1","amount":20,"currency":"USD","reason":"Manual top-up"}
```

### `POST /api/v1/billing/wallet/debit`
- Auth: cookie + `ADMIN`
- Body:
```json
{"userId":"usr_1","amount":5,"currency":"USD","reason":"Adjustment"}
```

### `POST /api/v1/billing/invoices/issue`
- Auth: cookie
- Body:
```json
{"customerUserId":"usr_1","currency":"USD","discountPercent":10,"discountReason":"Promo","lines":[{"type":"MEMBERSHIP_PLAN","membershipPlanId":"mp_1","quantity":1}]}
```
- Response:
```json
{"invoiceId":"inv_1","invoiceNumber":"INV-0001"}
```

### `GET /api/v1/billing/invoices/:invoiceId`
- Auth: cookie
- Response:
```json
{"invoice":{"id":"inv_1","invoiceNumber":"INV-0001","status":"ISSUED"}}
```

### `GET /api/v1/billing/invoices/:invoiceId/outstanding`
- Auth: cookie
- Response:
```json
{"id":"inv_1","invoiceNumber":"INV-0001","currency":"USD","status":"ISSUED","outstanding":{"totalAmount":100,"paidAmount":40,"outstandingAmount":60,"isOverdue":false}}
```

### `GET /api/v1/billing/receivables?userId=`
- Auth: cookie
- Response:
```json
{"userId":"usr_1","totalOutstanding":60,"invoices":[{"invoiceId":"inv_1","invoiceNumber":"INV-0001","outstandingAmount":60}]}
```

### `POST /api/v1/billing/payments/manual`
- Auth: cookie + `ADMIN`
- Body:
```json
{"invoiceId":"inv_1","method":"CASH","amount":40,"referenceNumber":"R-1"}
```
- Response:
```json
{"invoiceId":"inv_1","payment":{"id":"pay_1","method":"CASH","amount":40},"outstanding":{"outstandingAmount":20}}
```

## Workflows

### `GET /api/v1/workflows/recipes/:recipeId/timeline?version=`
- Auth: cookie
- Response:
```json
{"recipe":{"id":"rec_1","name":"Demo Recipe","version":1},"timeline":{"model":"timeline","totalDurationSeconds":1800,"segments":[]}}
```

### `POST /api/v1/workflows/recipes/:recipeId/materialize`
- Auth: cookie
- Body:
```json
{"version":1}
```

### `POST /api/v1/workflows/runs`
- Auth: cookie
- Body:
```json
{"recipeId":"rec_1","bookingId":"bkg_1","contextJson":{"source":"instructor"}}
```
- Response:
```json
{"run":{"id":"run_1","recipeId":"rec_1","status":"RUNNING"}}
```

### `GET /api/v1/workflows/runs/active`
- Auth: cookie
- Response:
```json
{"runs":[{"id":"run_1","recipeId":"rec_1","status":"RUNNING"}]}
```

### `GET /api/v1/workflows/runs/:runId`
- Auth: cookie
- Response:
```json
{"run":{"id":"run_1","recipeId":"rec_1","status":"RUNNING","steps":[]},"progress":{"totalSteps":6,"completedSteps":2,"skippedSteps":0,"terminalSteps":2,"nextTimerAt":null}}
```

### `POST /api/v1/workflows/runs/:runId/pause`
- Auth: cookie
- Response:
```json
{"run":{"id":"run_1","status":"PAUSED"}}
```

### `POST /api/v1/workflows/runs/:runId/resume`
- Auth: cookie
- Response:
```json
{"run":{"id":"run_1","status":"RUNNING"}}
```

### `POST /api/v1/workflows/runs/:runId/tick`
- Auth: cookie
- Response:
```json
{"run":{"id":"run_1","status":"RUNNING"},"progress":{"nextTimerAt":null}}
```

### `POST /api/v1/workflows/runs/:runId/steps/:runStepId/complete`
- Auth: cookie
- Response:
```json
{"run":{"id":"run_1"}}
```

### `POST /api/v1/workflows/runs/:runId/steps/:runStepId/skip`
- Auth: cookie
- Response:
```json
{"run":{"id":"run_1"}}
```

### `POST /api/v1/workflows/runs/:runId/steps/:runStepId/rollback`
- Auth: cookie
- Body:
```json
{"reason":"Need to rewind step"}
```

### `GET /api/v1/workflows/events?runId=&userId=&stepId=&types=&from=&to=&limit=`
- Auth: cookie
- Response:
```json
{"filters":{"runId":"run_1","limit":50},"events":[{"id":"evt_1","workflowRunId":"run_1","eventType":"STEP_COMPLETED"}]}
```

## Notifications

### `POST /api/v1/notifications/events`
- Auth: cookie
- Body:
```json
{"userId":"usr_1","scenario":"BOOKING_SUCCESS","subject":"Booking confirmed","payload":{"bookingId":"bkg_1"},"autoDeliver":true}
```
- Response:
```json
{"id":"ntf_1","status":"QUEUED"}
```

### `POST /api/v1/notifications/dispatch-due`
- Auth: cookie + admin role enforced by service
- Body:
```json
{"limit":50}
```

### `GET /api/v1/notifications/history`
- Auth: cookie
- Response:
```json
{"filters":{"limit":50},"notifications":[{"id":"ntf_1","scenario":"BOOKING_SUCCESS","status":"SENT"}]}
```

### `GET /api/v1/notifications/preferences`
- Auth: cookie
- Response:
```json
{"id":"pref_1","userId":"usr_1","globalMuted":false,"mutedCategories":[]}
```

### `PUT /api/v1/notifications/preferences`
- Auth: cookie
- Body:
```json
{"userId":"usr_1","globalMuted":true,"mutedCategories":["CLASS_REMINDER"]}
```

## Webhooks

### `GET /api/v1/webhooks/configs`
- Auth: cookie
- Response:
```json
{"configs":[]}
```

### `POST /api/v1/webhooks/configs`
- Auth: cookie
- Body:
```json
{"name":"Local target","eventKey":"booking.success","endpoint":"http://host.docker.internal:5001/webhook","signingSecret":"secret","status":"ACTIVE"}
```

### `PUT /api/v1/webhooks/configs/:configId`
- Auth: cookie
- Body:
```json
{"endpoint":"https://example.com/webhook"}
```

### `POST /api/v1/webhooks/emit`
- Auth: cookie
- Body:
```json
{"eventKey":"booking.success","payload":{"bookingId":"bkg_1"}}
```

### `POST /api/v1/webhooks/dispatch-due`
- Auth: cookie
- Body:
```json
{"limit":50}
```

### `GET /api/v1/webhooks/logs`
- Auth: cookie
- Response:
```json
{"filters":{"limit":50},"logs":[{"id":"log_1","eventKey":"booking.success","deliveryStatus":"SENT"}]}
```

### `GET /api/v1/webhooks/failure-alerts`
- Auth: cookie
- Response:
```json
{"filters":{"limit":50},"alerts":[{"id":"alert_1","status":"OPEN","failureCount":3}]}
```

### `POST /api/v1/webhooks/failure-alerts/:alertId/ack`
- Auth: cookie
- Response:
```json
{"id":"alert_1","status":"ACKED"}
```

## Analytics

### `POST /api/v1/analytics/recipes/:recipeId/views`
- Auth: cookie
- Body:
```json
{"sessionId":"sess_1","viewedAt":"2026-04-01T12:00:00.000Z"}
```

### `GET /api/v1/analytics/recipes/view-volume?from=&to=&limit=`
- Auth: cookie + `ADMIN`
- Response:
```json
{"timezone":"UTC","totals":{"views":20,"uniqueRecipes":4},"topRecipes":[{"recipeId":"rec_1","recipeCode":"DEMO","recipeName":"Demo Recipe","cuisineTags":["asian"],"views":12,"uniqueUsers":3,"uniqueSessions":4,"dailyViews":[{"day":"2026-04-01","views":5}]}],"dailyDrilldown":[{"day":"2026-04-01","views":5}]}
```

### `GET /api/v1/analytics/recipes/cuisine-interest?from=&to=&limit=`
- Auth: cookie + `ADMIN`
- Response:
```json
{"timezone":"UTC","totals":{"views":20,"weightedViews":20},"distribution":[{"cuisineTag":"asian","weightedViews":8,"percentage":40}],"dailyDrilldown":[{"day":"2026-04-01","cuisines":[{"cuisineTag":"asian","weightedViews":3}]}]}
```

### `GET /api/v1/analytics/workflows/weekly-streaks?from=&to=&userId=`
- Auth: cookie + `ADMIN`
- Response:
```json
{"timezone":"UTC","userId":"usr_1","rule":"At least one COMPLETED workflow run in a UTC calendar week.","totals":{"weeksInRange":4,"activeWeeks":3,"currentStreakWeeks":2,"longestStreakWeeks":3},"weeklyDrilldown":[{"weekStartUtc":"2026-03-30","hasCompletion":true}]}
```

### `GET /api/v1/analytics/workflows/difficulty-progression?from=&to=&userId=`
- Auth: cookie + `ADMIN`
- Response:
```json
{"timezone":"UTC","scoreScale":{"EASY":1,"MEDIUM":2,"HARD":3,"EXPERT":4},"totals":{"completedRuns":8,"averageDifficultyScore":2.5,"distribution":{"EASY":2,"MEDIUM":4,"HARD":2,"EXPERT":0}},"dailyDrilldown":[{"day":"2026-04-01","completedRuns":2,"averageDifficultyScore":2.5,"primaryDifficulty":"MEDIUM","distribution":{"EASY":0,"MEDIUM":2,"HARD":0,"EXPERT":0}}]}
```

### `GET /api/v1/analytics/workflows/completion-accuracy?from=&to=&userId=`
- Auth: cookie + `ADMIN`
- Response:
```json
{"timezone":"UTC","totals":{"completed":12,"skipped":2,"rolledBack":1},"percentages":{"completed":80,"skipped":13.33,"rolledBack":6.67},"dailyDrilldown":[{"day":"2026-04-01","completed":3,"skipped":1,"rolledBack":0,"percentages":{"completed":75,"skipped":25,"rolledBack":0}}]}
```

### `GET /api/v1/analytics/exports/:dataset.csv?from=&to=&userId=`
- Auth: cookie + `ADMIN`
- Response: CSV attachment stream
```http
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="analytics-recipe_view_volume-20260401-120000.csv"
```

## Notes

- All protected mutation routes are subject to the signing/idempotency middleware described in `docs/design.md`.
- CSV exports are permissioned and audited.
- The generated OpenAPI output should be treated as the source of truth for schema refinement; this document is the curated human-readable companion.

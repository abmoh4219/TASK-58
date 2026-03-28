# Business Logic Questions Log

## 1. Offline Operation and Authentication
**Question:** How should authentication and sessions work in a fully offline/LAN environment?

**Understanding:** No external auth providers or cloud identity services should be used.

**Solution:** Implement local username/password authentication with Argon2id hashing, JWT in HttpOnly cookies, rate limiting, and account lockout.

---

## 2. Booking Conflict Rules
**Question:** How should overlapping bookings be handled?

**Understanding:** Users must not be able to book overlapping time slots.

**Solution:** Validate booking windows before saving and return a conflict error when overlap exists.

---

## 3. Waitlist Behavior
**Question:** How should waitlist promotion work when a seat opens?

**Understanding:** The system should behave predictably and fairly.

**Solution:** Use FIFO ordering with auto-promotion when a seat is released.

---

## 4. Membership Priority
**Question:** Do members receive priority booking?

**Understanding:** The prompt says members can renew or rebook 24 hours earlier than non-members.

**Solution:** Enforce early access windows based on membership status.

---

## 5. Pricing and Invoice History
**Question:** How should pricing updates affect old invoices?

**Understanding:** Past invoices must remain unchanged.

**Solution:** Use versioned price books and immutable invoice snapshots.

---

## 6. Billing and Tender Types
**Question:** How should payments be recorded without online payment gateways?

**Understanding:** Internet payments are out of scope.

**Solution:** Record manual tender types such as cash, check, and manual card entry.

---

## 7. Cancellation Fees
**Question:** How should cancellation penalties be calculated?

**Understanding:** The prompt specifies different fee tiers based on time before class.

**Solution:** Apply deterministic policy:
- free cancellation up to 24 hours before
- 50% charge within 24 hours
- 100% charge within 2 hours

---

## 8. Recipe Workflow Structure
**Question:** How should cooking steps be represented?

**Understanding:** The workflow needs sequential, parallel, and timed tasks.

**Solution:** Represent recipes as executable workflows with timers, waits, rollback, and temperature cues.

---

## 9. Hands-Free Kitchen UX
**Question:** How should the cooking UI support hands-free use?

**Understanding:** The interface must be usable safely during cooking.

**Solution:** Use large touch-friendly controls, clear timeline views, spoken step readouts, and strong contrast.

---

## 10. Notifications
**Question:** How should notifications be delivered and tracked?

**Understanding:** The system needs templated notifications and a delivery history.

**Solution:** Store notifications locally, support mute controls, and track delivery history.

---

## 11. Analytics
**Question:** Which metrics should be tracked for staff reporting?

**Understanding:** The prompt asks for culinary learning metrics.

**Solution:** Track recipe views, streaks, difficulty progression, completion accuracy, and cuisine interest distribution.

---

## 12. Consent and Privacy
**Question:** What privacy controls are required?

**Understanding:** The prompt requires explicit consent capture and data minimization defaults.

**Solution:** Store consent flags, minimize stored personal data, and secure sensitive fields at rest.

---

## 13. Webhooks and API Versioning
**Question:** How should local integrations be secured and maintained?

**Understanding:** The system needs versioned endpoints, retries, and admin alerts.

**Solution:** Prefix APIs with /api/v1/, sign webhook requests with HMAC, retry failures, and alert admins on failure.

---

## 14. Frontend ↔ Backend Integration
**Question:** Should the frontend rely on real APIs or placeholders?

**Understanding:** The final product must be production-grade.

**Solution:** All frontend features must connect to real backend APIs. No mock data in production flows.
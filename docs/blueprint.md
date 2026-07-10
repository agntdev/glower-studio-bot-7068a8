# GlowEr Beauty Studio Bot — Bot specification

**Archetype:** booking

**Voice:** professional and warm — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot for GlowEr beauty studio that lets clients browse services, view photos and reviews, book appointments, and submit post-visit reviews with optional photos. Studio staff manage services, prices, gallery, and respond to reviews from a private admin Telegram chat. All appointment notifications go to the admin chat.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- GlowEr clients (public Telegram users)
- Studio staff (admins and staff roles)

## Success criteria

- Clients can successfully book appointments and receive confirmation messages
- Admins receive real-time notifications of new bookings and can manage them from the private admin chat
- Clients can submit post-visit reviews with optional photos after appointments are marked as completed

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu with options to browse services, view gallery, reviews, and book appointments
- **Browse Services** (button, actor: user, callback: services:list) — View a list of available services by category
  - inputs: service category filter
  - outputs: service list with details
- **View Gallery** (button, actor: user, callback: gallery:list) — View a paginated photo gallery with captions and service/category filters
  - inputs: service/category filter
  - outputs: gallery items with captions
- **Read Reviews** (button, actor: user, callback: reviews:list) — View customer reviews with star ratings and optional photos
  - inputs: sort by newest/highest-rated
  - outputs: review list with ratings and photos
- **Book Appointment** (button, actor: user, callback: booking:start) — Start the guided booking flow to select service, date, time, and client details
  - inputs: service selection, date selection, time selection, client name, client phone
  - outputs: booking confirmation and summary
- **Submit Review** (button, actor: user, callback: review:start) — Submit a post-visit review with star rating and optional photos
  - inputs: star rating, review text, review photos
  - outputs: review submission confirmation
- **/admin** (command, actor: admin, command: /admin) — Open the admin menu for managing services, gallery, reviews, and appointments
  - inputs: admin authentication
  - outputs: admin menu options
- **Manage Services** (button, actor: admin, callback: admin:services) — Create, edit, or delete services and prices
  - inputs: service details, price, duration, categories
  - outputs: updated service list
- **Manage Gallery** (button, actor: admin, callback: admin:gallery) — Add or delete photos with captions and service associations
  - inputs: photo, caption, service association
  - outputs: updated gallery
- **Manage Reviews** (button, actor: admin, callback: admin:reviews) — View and respond to client reviews
  - inputs: review response, mark as handled
  - outputs: updated review list with responses
- **View Appointments** (button, actor: admin, callback: admin:appointments) — List upcoming bookings and manage their status
  - inputs: appointment status changes, notes
  - outputs: updated appointment list

## Flows

### Client Start Flow
_Trigger:_ /start

1. Display welcome message with quick links to Services, Gallery, Reviews, Book an appointment, Contact
2. Wait for user to select an option

_Data touched:_ User

### Browse Services Flow
_Trigger:_ services:list

1. List services by category
2. Show service details when selected
3. Offer to book the service

_Data touched:_ Service

### Gallery Flow
_Trigger:_ gallery:list

1. Display paginated gallery items
2. Filter by service/category
3. Show photo captions and tags

_Data touched:_ Gallery item

### Review Flow
_Trigger:_ reviews:list

1. Display reviews sorted by newest/highest-rated
2. Show review details including photos

_Data touched:_ Review

### Booking Flow
_Trigger:_ booking:start

1. Select service
2. Pick date
3. Pick time slot based on service duration and studio hours
4. Optionally choose staff member
5. Enter/confirm client name and phone
6. Confirm booking
7. Send booking summary and optional calendar file

_Data touched:_ Appointment, User

### Post-Visit Review Flow
_Trigger:_ appointment:completed

1. Send review prompt to client after appointment is marked completed
2. Collect star rating and optional text/photo
3. Submit review

_Data touched:_ Review, Appointment

### Admin Start Flow
_Trigger:_ /admin

1. Authenticate admin user
2. Display admin menu with options to manage services, gallery, reviews, and appointments

_Data touched:_ User

### Admin Manage Services Flow
_Trigger:_ admin:services

1. Create/edit/delete services using message-based commands or inline forms
2. Update service details in the database

_Data touched:_ Service

### Admin Manage Gallery Flow
_Trigger:_ admin:gallery

1. Add/delete photos with captions and service associations
2. Update gallery in the database

_Data touched:_ Gallery item

### Admin Manage Reviews Flow
_Trigger:_ admin:reviews

1. View incoming reviews
2. Reply publicly or mark as handled
3. Update review status in the database

_Data touched:_ Review

### Admin View Appointments Flow
_Trigger:_ admin:appointments

1. List upcoming bookings
2. Confirm/cancel appointments
3. Mark as completed
4. Receive real-time notifications of new bookings

_Data touched:_ Appointment

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Service** _(retention: persistent)_ — Beauty service offered by the studio
  - fields: name, description, duration, price, categories/tags
- **Gallery item** _(retention: persistent)_ — Photo with caption and optional service association
  - fields: photo, caption, tags, service association
- **Review** _(retention: persistent)_ — Client feedback with star rating and optional photos
  - fields: star rating, text, photos, author name, Telegram id, appointment id
- **Appointment** _(retention: persistent)_ — Client booking details
  - fields: client name, contact (Telegram id and phone), service, date/time, staff, status, notes
- **User** _(retention: persistent)_ — Client or admin profile
  - fields: Telegram id, name, phone, booking history, admin role

## Integrations

- **Telegram** (required) — Bot API messaging
- **Telegram Admin Chat** (required) — Admin notifications and management interface
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Manage services and prices
- Manage gallery items
- Respond to reviews
- View and manage appointments
- Configure admin staff access
- Set studio hours and booking rules

## Notifications

- New appointment notifications in admin chat
- Booking cancellation/change notifications in admin chat
- Incoming review notifications in admin chat
- Post-visit review prompts to clients

## Permissions & privacy

- Client data (name, phone, booking history) is stored securely
- Admin access is restricted to authorized staff
- Client photos are stored with consent
- Review data is visible to all users but responses are from admins

## Edge cases

- Client tries to book a time slot that's already taken
- Admin tries to manage services without proper authentication
- Client submits a review without having an appointment
- Client uploads more than 3 photos in a review
- Admin chat is not properly configured
- Client provides invalid phone number during booking

## Required tests

- Client can successfully book an appointment and receive confirmation
- Admin receives real-time notifications of new bookings and can manage them
- Client can submit a post-visit review with photos after an appointment is marked as completed
- Admin can manage services, gallery, and reviews from the private admin chat
- Bot handles invalid inputs and edge cases gracefully

## Assumptions

- Admin chat is a single private Telegram group where all admin notifications and management actions occur
- Booking availability uses simple studio opening hours and existing bookings
- Appointments are created as 'booked' and require admin confirmation
- Post-visit review prompts are triggered manually by admin marking an appointment as completed
- Clients are identified by their Telegram id
- Simple conversational UI is used for all client interactions
- Studio local timezone is used for all appointments and timestamps

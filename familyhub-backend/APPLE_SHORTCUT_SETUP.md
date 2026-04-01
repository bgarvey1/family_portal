# "Send to FamilyHub" — Apple Shortcut Setup

This creates a Share Sheet shortcut on iPhone/iPad/Mac that uploads photos
directly to FamilyHub with full EXIF (GPS, timestamp, camera) preserved.

## Create the Shortcut

1. Open the **Shortcuts** app on your iPhone/iPad/Mac
2. Tap **+** to create a new shortcut
3. Name it: **Send to FamilyHub**
4. Tap **Add Action** and build these steps:

### Step 1: Receive input
- Action: **Receive** what's shared from the **Share Sheet**
- Types: **Images** (and optionally **Files**)
- If there is no input: **Stop and Respond** "No photo selected"

### Step 2: Set your name
- Action: **Text**
- Content: `Brendan` (or whoever's phone this is — change per family member)
- Set variable name: `contributor`

### Step 3: Upload to FamilyHub
- Action: **Get Contents of URL**
- URL: `https://familyhub-backend-761807984124.us-east1.run.app/api/upload`
- Method: **POST**
- Headers:
  - `x-api-key`: `82499e764781230d465dc768064fb155b821f510ee1fad6db71938f7ea59182f`
- Request Body: **Form**
  - `file`: **Shortcut Input** (the shared photo)
  - `contributor`: **contributor** variable

### Step 4: Show result
- Action: **Show Notification**
- Title: "Sent to FamilyHub!"
- Body: **Get Dictionary Value** `title` from step 3 result

## Enable in Share Sheet

5. Tap the **ⓘ** (info) button on the shortcut
6. Enable **Show in Share Sheet**
7. Under "Share Sheet Types", select **Images**

## Usage

- Open Photos app → select a photo → tap **Share** → tap **Send to FamilyHub**
- Works from Camera, Safari, Files, or anywhere the share sheet appears
- Photo uploads with full EXIF, gets classified by AI automatically
- Shows a notification with the AI-generated title when done

## Per-Family-Member Setup

Each family member installs the shortcut on their device with their own name:
- Mom's phone: contributor = "Mom"
- Ryan's phone: contributor = "Ryan"
- Justin's phone: contributor = "Justin"

The `contributor` field tracks who uploaded each photo.

## Alternative: iCloud Shared Shortcut Link

Once you have the shortcut working on your device, you can share it:
1. Long-press the shortcut → **Share**
2. Copy the iCloud link
3. Send to family members
4. They just need to change the `contributor` name to their own

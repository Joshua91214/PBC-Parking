# PBC Parking

A phone-friendly web app that tells church ushers where each arriving car
should park, so the team doesn't have to coordinate over walkie-talkies.

## How it works on a Sunday

1. **Entrance**: A greeter looks at the car and taps **Small**, **Medium**,
   **Large**, or **Van**. The app picks the best open spot and shows a big
   number (e.g. **#14**). The greeter says: *"Your number is 14, please drive
   forward and tell the next usher."*
2. **Ushers**: Each usher picks the zone they're standing in, then types the
   number the driver gives them. The screen says one of:
   - **PARK HERE → spot C4, back in**: guide the car into the spot.
   - **KEEP GOING ⬆ to Back (by Church)**: wave them on.
   - **TURN AROUND**: the spot is behind them (rare).

   A small map highlights the spot. Tap **✓ Parked** when the car is in.
   The usher screen also lists the numbers headed to that usher's zone, so
   they know who's coming.
3. **Problems**:
   - **Spot is taken** (someone parked without a number, or there's a cone):
     tap **Spot taken**. The app blocks that spot and gives the car a new one.
   - **Wrong size**: use **Fix…** / **More…** to change it. The car gets a
     new spot.
   - **Lot full**: the entrance screen shows your overflow instructions.

All phones update live. Every assignment happens in one place on the server,
so two people can never hand out the same spot.

### How spots are chosen

- Spots fill in **fill order** (set per row). By default the sample lot fills
  the back first, which keeps the entrance lane clear.
- **Big, small, big, small**: a Large or Van is not placed right next to
  another Large or Van when there's a reasonable alternative. The app skips
  ahead a spot, and the next small car fills the gap.
- **Vans** go only to spots marked as van-size. Small cars stay out of those
  spots while regular ones are open.
- **Reserved** spots (e.g. accessible parking) are never auto-assigned.
- **Front vs. back in**: each row, or single spot, can be set to *Pull in
  forward*, *Back in*, or *Auto*. Auto tells large vehicles and vans to pull
  in forward (easier), and small and medium cars to back in (quicker exit
  after service).

## Setting up your lot

Open **Setup**:

1. **Zones**: name the areas of the lot *in the order a car drives past
   them* (e.g. Front, Middle, Back). Ushers pick one of these.
2. **Rows**: each row of spots has a label (A, B, C…), a zone, a spot count,
   a position on the map, and a fill order. Spot IDs are the row label plus
   the number (`A1`, `A2`, …). **Paint or post these labels in the real lot**
   so ushers and drivers can find them.
3. **Tap any spot** in the preview to mark it van-size, reserved, or give it
   its own parking direction or a note.
4. **Save layout**, then use **Backup** to copy the layout JSON somewhere
   safe.

Before each service, tap **Start new session** to clear the numbers.

## Running it

Requires [Node.js](https://nodejs.org) 18 or newer. There are no other
dependencies.

```bash
npm start            # http://localhost:3000
npm test
```

Everyone's phone needs to reach the server:

- **On the church Wi-Fi**: run it on any always-on computer and have
  volunteers open `http://<that-computer's-IP>:3000`.
- **On the internet** (works on cellular data too): deploy to any Node host
  (Render, Railway, Fly.io, a small VPS). Set `ACCESS_CODE` so only your
  team can use it, and keep the `data/` folder on persistent storage.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `ACCESS_CODE` | *(none)* | If set, phones must enter this code once |
| `DATA_FILE` | `data/state.json` | Where the lot and session are saved |

On a phone, use **Add to Home Screen** to open the app like a native app.

## Project layout

```
server.js          HTTP server, JSON API, live updates (Server-Sent Events)
lib/core.js        Spot assignment + map geometry (shared with the browser)
lib/store.js       Session actions: new car, parked, reassign, cancel…
lib/defaultLot.js  Sample lot used until you save your own
public/            The web app (Entrance, Usher, Map, Setup screens)
test/              node:test suites
```

# Setting up Kids Camera Games at home

A plain-language guide for families. No technical knowledge needed. If you are a developer, the
[README](../README.md) has the short version and all the keyboard shortcuts.

The game shows a cartoon world on your TV. A camera watches the room, finds the kids, and drops them into
the picture so they can pop bubbles, dodge rocks, jump waves and copy dance poses. Up to four kids can play
at once.

**To play, open [https://calum.github.io/kids-camera-games/](https://calum.github.io/kids-camera-games/)** in Chrome, Edge or Safari. There is nothing to install.

**Nothing is recorded or uploaded.** The camera picture is processed on your own device and never leaves it.
After the first visit the game also works offline.

## Which setup is for you?

| | Phone or tablet | Laptop and webcam |
|---|---|---|
| What you need | A phone or tablet and a way to show it on the TV (a cable or screen mirroring) | A laptop, a USB webcam, and an HDMI cable to the TV |
| Setup time | A few minutes | A few minutes |
| Picture | Phones have a wide lens, so they fit more kids in | Depends on the webcam; a wide-angle one is best |
| Delay | Lowest with a cable; mirroring adds a small lag | Lowest |
| Controls | Tap the screen for buttons | The keyboard, or tap or move the mouse for buttons |

Smart TV web browsers cannot use a camera, so the game cannot run on the TV itself.

---

## Setup A: a phone or tablet runs the game

The idea is simple: the phone or tablet is both the camera and the game. You prop it under the TV facing the
kids and show its screen on the TV.

### What you need

- A phone or tablet made in the last five or six years. Newer and faster is smoother.
- A way to show the phone's screen on the TV, one of:
  - **A cable** (best). A USB-C to HDMI cable or adapter for most Android phones and iPads, or a Lightning to
    HDMI adapter for older iPhones. Cables have the least delay.
  - **Screen mirroring**: AirPlay to an Apple TV or AirPlay-compatible TV, or Chromecast / "Cast screen" on
    Android. Mirroring adds a small delay (around a tenth to a third of a second). The game is forgiving about
    timing, so this is usually fine.
- Something to prop the phone up: a small stand, a book, or a bit of Blu Tack.

### Steps

1. Open [https://calum.github.io/kids-camera-games/](https://calum.github.io/kids-camera-games/) in your phone's browser (Safari on iPhone and iPad, Chrome on Android).
2. Tap **Allow** when it asks to use the camera. The game starts with the **front** camera, the one on the
   screen side, so the kids can see the screen while the camera sees them. To use the back camera instead,
   tap the screen and then **📷 Camera**.
3. Turn the phone **sideways** (landscape). The game warns you if it is upright, because an upright picture
   is tall and narrow and misses kids at the sides.
4. Connect the cable or start mirroring, so the game shows on the TV.
5. Prop the phone under or on top of the TV, centred, with the camera pointing at the middle of the room and
   tilted very slightly down. Make sure the camera lens is not covered by your stand.
6. For a full screen with no browser bars: on Android and iPad, tap **⛶ Full screen** on the start screen
   (next to "Full screen works best on a TV."). On iPhone, web pages cannot go full screen, so the game
   says "For full screen: Share, then Add to Home Screen". Do that, then open the game from its new icon.
7. Plug the phone into power. A game session drains a battery quickly. The game keeps the screen awake
   by itself, so it will not dim or lock mid-game.

There is no keyboard on a phone, so **tap the screen** to show the grown-up buttons: **▶ Start**,
**⏭ Next level**, **⏏ Menu**, **📷 Camera** and **⛶ Full screen**. They fade away after a few seconds.

### Tips

- Turn on **Do Not Disturb** so calls and messages do not pop up over the game.
- If the phone gets hot and the game gets jerky after a while, give it a rest or point a fan at it. The game
  drops to a lighter mode on its own, but phones throttle when hot.
- Keep the cable and the phone out of the kids' reach. They will be jumping.

---

## Setup B: a laptop with a webcam

This is how the game was built and tested.

### What you need

- A laptop (Windows, Mac or Linux) with Chrome or Edge.
- A USB webcam. Any webcam works, but a **wide-angle** one (90 degrees or more) fits more kids in. 720p at
  30 frames a second is plenty.
- An HDMI cable from the laptop to the TV. You can also play on the laptop's own screen for a test.
### Steps

1. Plug the webcam into the laptop and the HDMI cable into the TV. Set the laptop to show on the TV
   (on Windows press the Windows key and P, on a Mac use Displays in System Settings).
2. Open [https://calum.github.io/kids-camera-games/](https://calum.github.io/kids-camera-games/) in Chrome or Edge.
3. Click **Allow** when the browser asks for the camera.
4. Press **F** (or click **⛶ Full screen**) for fullscreen on the TV.
5. If the laptop has its own camera, the game may pick that one first. Press **C** to switch to the webcam.
   The game remembers your choice next time.

### Using a phone as the webcam instead

If you do not have a webcam, a phone can act as one. Install a phone-as-webcam app on the phone and the laptop
(on Windows 11 with an Android phone, "Link to Windows" can do this; Camo, Iriun and DroidCam are other
options). Connect by USB if you can, pick the wide or 0.5x lens if the app offers it, hold the phone
sideways, and press **C** in the game until the phone's picture appears.

### Playing without the internet

The game works offline after you have opened it once. To run your own copy instead, download the game,
install [Node.js](https://nodejs.org) (the "LTS" download), then double-click `start.bat` on Windows, or
type `node server.mjs` in a Terminal in the game folder on a Mac or Linux and open `http://localhost:8137`.

---

## Setting up the room

This makes the biggest difference to how well the game plays.

### Where to put the camera

- **On top of or just under the TV, centred**, tilted very slightly down. The kids look at the TV, so the camera
  sees them face-on.
- Higher is usually better than lower. A camera on the floor looks up at the kids and sees less of the room.

### How much space

- Kids stand **2 to 3 metres (7 to 10 feet) back** from the camera. The game needs to see their **whole body**,
  head to feet, with room for their arms stretched out to the sides.
- A typical webcam at 2.5 metres sees an area about 3.5 metres wide. That fits two or three kids comfortably.
  For four, stand further back or use a wide-angle camera or phone.
- Clear the floor. The kids will be jumping and stepping sideways to dodge rocks. Move coffee tables, toys
  and anything with sharp corners, and watch out for rugs that slide.
- Nobody should be standing between the camera and the kids, and the kids should not stand in front of each
  other. Side by side works best.

### Lighting

- **Light from the front**: lamps or ceiling lights on the same side as the TV, shining on the kids.
- **No bright window behind the kids.** A backlit kid is a silhouette to the camera and gets lost. Close the
  curtains or move so the window is to the side or behind the camera.
- Even light is better than one bright spot. Daylight through a side window plus the room lights is ideal.
- Turn off anything flashing or animated behind the kids, like a Christmas tree or a second screen.

### The background

- A plain wall behind the kids is easiest for the camera. Busy patterns and big mirrors can confuse it.
- The game works out what is "a person" partly by what moves against the still room. Anything that moves in
  the background (a fan, curtains blowing, a TV reflecting in a window) can cause odd ghosts in the cartoon.

### Pets and passers-by

- **Pets do not join in.** The game only counts something that looks like a standing person and stays in view
  for about half a second, so a dog trotting past is ignored.
- **Someone walking through during a game only watches.** A grown-up doing chores appears in the cartoon but
  cannot score or get hit. To join part-way through, hold your arms out like an airplane for 2 seconds.
- **A kid who steps out and comes back** is recognised by where they went and the colours they are wearing,
  and carries on with their own colour and score.
- The game tracks up to **four people** at once, so a crowd of watchers can still crowd out a player. Watch
  from the side, out of the camera's view, when you can.
- Movement still shows up in the cut-out, so a pet or a passer-by can appear as a ghostly shape for a moment.
- Big movement near the camera, like someone waving a hand in front of the lens, upsets the tracking for a
  second or two. It recovers on its own.

### TV settings

- Put the TV in **Game mode** (sometimes "PC mode" or "low latency"). It cuts the TV's own delay noticeably.
- Turn the sound up. The game uses sound cues, and a "NICE JUMP!" is more fun when you can hear it.

---

## Playing

### Joining

1. Everyone who wants to play stands in view. The screen says how many people it has spotted.
2. Each player holds their **arms straight out to the sides like an airplane**. A green ring and countdown
   appears over each kid who is in.
3. When nobody has joined or left for **3 seconds**, the game starts with exactly those players.
4. Anyone in view who did not hold their arms out **sits that game out**. They still appear in the cartoon,
   but they cannot score and nothing can hit them. This is handy for a toddler who just wants to be on the
   telly.
5. A grown-up can press **Space**, or tap **▶ Start**, to start with everyone, without the arms-out step.
6. Someone who arrives once the game is going holds their arms out for 2 seconds to join in.

### The four levels

| Level | What the kids do |
|---|---|
| **Pop the bubbles** (under the sea) | Wave your hands to pop bubbles. Gold ones are worth 3. |
| **Dodge the rocks** (volcano) | Watch for the "!" then step out of the way. The team shares 5 hearts. |
| **Jump the waves** (beach) | Count down 3-2-1 and jump as the wave rolls past. |
| **Dance party** (disco) | Copy the stick-figure pose on screen: arms up, airplane, or hands on head, and hold it. |

After the fourth level there is a winners screen, then the next round starts a little harder. Press **Esc**
or tap **⏏ Menu** to go back to the start so a new group can join.

### Grown-up controls

Tap the screen (or move the mouse) to show the buttons. On a laptop the keys do the same.

| Button | Key | What it does |
|---|---|---|
| **▶ Start** | **Space** | Start with everyone in view (and skip the winners screen) |
| **⏭ Next level** | **N** | Skip to the next level |
| **⏏ Menu** | **Esc** | Back to the start screen, so kids can join again |
| **📷 Camera** | **C** | Switch to the next camera (on a phone, front or back) |
| **⛶ Full screen** | **F** | Fill the whole screen |
| | **1** to **9** | Jump straight to a level |
| | **B** | Show the whole camera picture instead of the cartoon cut-out |
| | **D** | Show what the game sees (useful when something is not working) |

---

## If something is not working

**The browser never asks for the camera, or says the camera is blocked.**
Look for a camera icon in the browser's address bar and click it to allow the camera. In Chrome and Edge you
can also go to Settings, then Privacy, then Site settings, then Camera. If the game cannot get a camera at
all it switches to "mouse mode" so you can still see it working: move the mouse to move, click to jump.

**It shows the wrong camera (the laptop's own camera instead of the webcam).**
Press **C** or tap **📷 Camera** to switch. The game remembers your choice.

**The screen says "Step into view" but a kid is standing right there.**
The game needs to see the whole body. Step back until feet and head are both in the picture. Check the lighting:
a kid in front of a bright window is invisible to the camera. Press **B** to see the plain camera picture and
check what it actually sees.

**A kid's arms-out pose is not being noticed.**
Arms need to be straight out to the sides, roughly level with the shoulders, and held still for 3 seconds.
Small children are harder for the camera. Make sure both hands are in the picture and not hidden behind
another kid. Press **D** to see what the game thinks each kid is doing.

**It is jerky or slow.**
Close other programs and browser tabs. Plug the laptop into power (many laptops slow down on battery). On a
phone, let it cool down. The game switches to a lighter tracking mode by itself on slow machines. If it is
still slow, add `?lite` to the end of the web address, which turns off the glow effects.

**There is a delay between moving and seeing it on the TV.**
Put the TV in Game mode. If you are mirroring a phone wirelessly, a cable will be much snappier. Wi-Fi
webcam apps add delay too; USB is better.

**The cartoon shows strange blobs or ghosts.**
Something is moving in the background, or the light is changing (clouds, a flickering lamp). Press **B** to
see the camera picture. Keep pets and passers-by out, and close curtains that are blowing about.

**The picture is tall and narrow and kids at the sides are cut off.**
A phone is being held upright. Turn it sideways. The game shows a warning when this happens.

**The game is upside down or mirrored.**
Left and right are mirrored on purpose, like a mirror, so a kid raising their right hand sees it go up on
the right. If the picture is upside down, your phone is propped the wrong way round.

**A toddler keeps wandering into the frame and getting hit by rocks.**
Nothing can hit a kid who did not join. Only kids who held their arms out can lose hearts or score. Press
**Esc** or tap **⏏ Menu** and start again if the wrong people joined.

**The screen dims or the phone locks during a game.**
The game asks the phone to stay awake, but some browsers only allow it after a tap. Tap the screen once
after the game starts.

**Running your own copy: Windows says the port is in use, or the browser cannot find the page.**
Something else on the laptop is using the same address. Close other copies of the game. If that does not
help, start it with a different port: open a Terminal in the game folder and type `set PORT=9000` then
`node server.mjs` (Windows) and open `http://localhost:9000`.

---

## Safety

- Clear the floor and give the kids room to jump and step sideways without hitting furniture or each other.
- Keep cables tidy and out of the play area. A phone or laptop on the floor near jumping children will not
  last long.
- Prop phones and webcams so they cannot fall. A heavy book or a stand behind the phone is better than
  balancing it on the TV's edge.
- Keep sessions short, with water and rest breaks. Four levels is a good run for small kids.
- The dance level has moving disco spotlights. If anyone in the family is sensitive to flashing or moving
  lights, skip that level with **N**.

Have fun.

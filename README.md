## NCERT Timer Study

Minimalist dark NCERT question–practice app with a central timer and multiplayer race.

### What it does

- **Host creates a room** from their computer, chooses how many NCERT-style questions to run.
- **Share link with friends**; they open it in a browser to join the room.
- **Each round**:
  - Everyone sees the same NCERT-style question.
  - They **write the answer on paper**.
  - When a player finishes writing, they **hit the spacebar** → their finish time is recorded.
  - When **all players have hit space**, the **official-style NCERT answer is revealed** to everyone.
  - The answer text has a **smooth keyword highlight animation** to make sure you used the key phrases.
  - The **host hits Space** to move on to the next question.
- This repeats until the **selected number of rounds** is completed.

Everything is hosted from the **host computer**; your friends connect to the host’s IP over the network.

### Run it locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. On the **host machine**, open:

   ```text
   http://localhost:3000/host
   ```

4. Enter your **name** and **number of rounds**, click **Create room**.
5. Copy the **join link** that appears and send it to friends (they must be able to reach your IP / port 3000).

   - On your LAN this will typically look like:

     ```text
     http://YOUR_LOCAL_IP:3000/join/ROOMID
     ```

   - For friends over the internet you can use a tunnel (e.g. `ngrok`) to expose port 3000.

6. When everyone has joined, click **Start practice**.
7. During play:

   - **Players** press **Space** when they finish writing their answer; the app waits until all players are done.
   - Then the **answer appears with animated keyword highlights**.
   - The **host** presses **Space** to move to the next question.

### Customise with real NCERT questions

The sample questions/answers and keyword lists live in `server.js` inside the `QUESTION_BANK` array.

- Replace the sample `question`, `answer` and `keywords` entries with **exact NCERT text** and your own keyword lists.
- You can add more entries and increase the maximum rounds accordingly.

The UI is intentionally **minimalist, dark, rounded and low-distraction**, with brighter accent colours only for timers and keyword highlights.



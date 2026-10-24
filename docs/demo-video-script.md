# YapLab — 3-minute video script

| Part | Time | Made with | Content |
|---|---|---|---|
| 1. Purpose | 0:00–0:40 | Remotion (`video/`) | Why students need a room that talks back |
| 2. Design | 0:40–1:30 | Remotion (`video/`) | How the agent swarm, grounding, moderator, and voices work |
| 3. Demo | 1:30–3:00 | Screen recording | A live teaching session, from setup to the report |

**Format:** 1920×1080, 30 fps. Parts 1 and 2 are the `YapLabIntro` composition: 2,700 frames, exactly 90 seconds. The demo recording is appended after it.

**Pace:** about 140 spoken words per minute. Parts 1–2 carry 219 words of voice-over in 90 seconds; the demo carries about 200.

**Source of truth:** scene order, durations, and captions live in `video/src/scenes.ts`. If you change a timing or a line here, change it there too, and vice versa.

---

## Parts 1–2: Remotion intro (`YapLabIntro`)

Every scene shows its voice-over line as a burned-in caption (turn them off with `--props='{"captions":false}'`). Read the voice-over to the captions' timing, or record it afterwards over the rendered video.

### Part 1: Purpose — 0:00–0:40

| # | Scene (component) | Time | Frames | Visual | Voice-over / caption |
|---|---|---|---|---|---|
| 1 | `Alone` | 0:00–0:06 | 0–180 | Empty chalkboard. A single small avatar faces a blank wall panel; the room is silent. | "Most students rehearse presentations alone, talking to a wall." |
| 2 | `Wall` | 0:06–0:15 | 180–450 | Three lines stack in: *No audience.* *No questions.* *No idea what landed.* The last one lights up in marigold. | "A wall doesn't get confused. It doesn't drift off when you ramble, and it never asks the question your professor will." |
| 3 | `Brand` | 0:15–0:27 | 450–810 | The **YapLab** wordmark, then the tagline "Rehearse in front of a room that *talks back.*" Five avatars spring in below; one raises a hand. | "YapLab gives every student a room that talks back: a classroom of AI students who listen, react, raise their hands, and question you out loud." |
| 4 | `ForWho` | 0:27–0:40 | 810–1200 | Three cards slide in: *No study group* · *Practicing in a second language* · *No time for office hours*. Closing line: "Practice anytime. No judgment." | "It's built for students without a study group, students practicing in a second language, or anyone without time for office hours. Practice whenever you want, with no judgment." |

### Part 2: Design — 0:40–1:30

| # | Scene (component) | Time | Frames | Visual | Voice-over / caption |
|---|---|---|---|---|---|
| 5 | `Swarm` | 0:40–0:45 | 1200–1350 | Title "A swarm of agents, not a chatbot." Five avatars orbit into a ring. | "Under the hood, YapLab is a swarm of agents, not a single chatbot." |
| 6 | `Personas` | 0:45–0:58 | 1350–1740 | Five persona cards: Alex (confused first-year), Maya (skeptical professor), Ana (ESL student), Sam (distracted student), Priya (domain expert). Memory chips appear under them: *How I felt* · *What I asked* · *The talk so far*. | "Five listeners with their own personas, from a confused first-year to a skeptical professor. Each one remembers how it felt, what it asked, and the talk so far." |
| 7 | `Orchestrator` | 0:58–1:05 | 1740–1950 | An **Orchestrator** node in the center with a 15-second ring timer. When it completes, pulses travel to all five avatars at once; each lights up as it reacts. Label: "every 15 s · in parallel". | "Every fifteen seconds, the orchestrator sends what you just said to all of them at once." |
| 8 | `Grounding` | 1:05–1:12 | 1950–2160 | A transcript line: "The chain rule just says the effect of an early weight passes through every layer after it." Alex's question card appears with the quoted span underlined in marigold. A second card quoting something never said is struck through: *Rejected: not in your talk*. | "Every question must quote something you actually said or showed, or it's thrown out." |
| 9 | `Moderator` | 1:12–1:22 | 2160–2460 | A talk timeline. The first stretch is shaded *Warm-up: hands down*. Then one hand goes up (Alex, with a **Call on Alex** chip) while the other questions slide into a *Saved for Q&A* tray, and its counter climbs. | "A moderator keeps it a real class: no interrupting your intro, one hand at a time, the quietest confused student first, and the rest saved for Q&A." |
| 10 | `Voices` | 1:22–1:30 | 2460–2700 | A waveform plays from Alex's avatar ("Students speak in their own voices", chip *ElevenLabs text-to-speech*), and a mic feeds a live transcript ("Your speech, transcribed live in the browser", chip *ElevenLabs Scribe · keys stay on our server*). Ends on "Let's see it live →" and fades to the board color for the cut to the demo. | "Students speak in their own ElevenLabs voices, and your speech is transcribed live in the browser." |

---

## Part 3: Demo — 1:30–3:00 (screen recording)

**Setup before recording:** the deployed app at `https://35-229-50-202.sslip.io` (or local), Chrome, a headset, voices on, camera off. Record at 1920×1080, 30 fps, to match the intro.

| Time | On screen | Audio |
|---|---|---|
| 1:30 | Home → **Start teaching** → Setup: **Lecture rehearsal**, demo deck *Backpropagation, explained* → **Enter the classroom**. | VO: "Let's teach a short lesson on backpropagation." |
| 1:38 | The room waits: "Click Speak when you're ready. The room is listening." Click **Speak**. | VO: "The room waits until I start talking." |
| 1:42 | Slide 1, *A network that guesses wrong*. Avatars listening. | **Presenter:** "Today we're going to talk about how neural networks learn. We give a network a photo, it says cat, but it was actually a dog. So how do we correct it?" |
| 1:52 | Slide 2, *Loss*. Sam's avatar goes distracted; the room gauge dips. | **Presenter:** "First we measure how wrong the guess was. That number is the loss: a bigger mistake gives a bigger loss." |
| 2:00 | **Jump cut** (warm-up passes). Slide 3, *The chain rule as gears*. | **Presenter:** "The chain rule just says the effect of an early weight passes through every layer after it." |
| 2:06 | Alex raises a hand; the **Call on Alex** card appears. | VO: "Alex is lost, and raises a hand about the exact sentence I just said." |
| 2:10 | Click **Call on Alex**. Alex speaks. | **Alex (voice):** "Sorry, could you walk through the chain rule again? I didn't follow how the effect passes backwards." |
| 2:16 | Presenter answers, then clicks **Done answering**. | **Presenter:** "Think of gears: each layer turns the next. To see how much the first gear moves the output, you multiply the gear ratios along the chain." |
| 2:26 | The verdict line appears: "Alex: Answered: …"; Alex nods. | VO: "Alex judges my answer: answered, partial, or dodged." |
| 2:31 | Click **End talk** → **Next question**. Priya speaks. | **Priya (voice):** a saved Q&A question, for example about the learning rate. |
| 2:38 | Presenter gives a one-line answer → **Finish and see report**. | VO: "Saved questions come back at the end, like real Q&A." |
| 2:44 | Report: **Delivery** (pace, fillers, longest pause), **Questions and answers** with verdicts, **Last room check**. | VO: "Then I get the report: my pace and filler words, every question with how I handled it, and how the room felt." |
| 2:54 | Back to the home hero. Logo and URL. | VO: "YapLab. Rehearse in front of a room that talks back." |

---

## Producing the video

1. **Preview and render the intro.**
   ```bash
   cd video
   npm install
   npm run studio      # preview and scrub in the browser
   npm run render      # out/yaplab-intro.mp4 (90 s, captions on)
   ```
2. **Record the demo** following Part 3, trimmed to about 90 seconds.
3. **Join them.** `video/join.sh` appends the demo to the intro. It handles the intro's missing audio track and scales the demo to 1920×1080 at 30 fps:
   ```bash
   cd video && ./join.sh path/to/demo.mp4     # writes out/yaplab.mp4
   ```
4. **Voice-over.** Record Parts 1–2 while watching the captioned render so the lines land on their scenes. Add captions to the demo in the editor; judges often watch muted.

## Recording notes

- **Warm-up timing.** Hands stay down until 45 seconds *and* 60 words into the talk. Either record a full take and jump-cut at 2:00 (recommended: the behavior is real), or shorten it just for recording with `FRONTROW_MODERATOR_WARMUP_SECONDS=20`, `FRONTROW_MODERATOR_WARMUP_MIN_WORDS=40`, and `FRONTROW_TICK_INTERVAL_SECONDS=10` in `.env`. To apply it on the VM, run `infra/gcp/deploy.sh --api-only --push-env`.
- **Questions vary.** The questions are generated live, so wording differs each take. Record 2–3 takes and keep the one where a hand goes up on the chain-rule line. The chain-rule sentence is the most reliable trigger.
- **Audio.** Use a headset so student voices don't leak into the mic. YapLab also mutes transcription while a student speaks.
- **Click "Enable student audio"** if the browser blocks autoplay on the first question.

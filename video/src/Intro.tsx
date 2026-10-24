import { Sequence } from 'remotion';
import { Board, Caption, SceneFade } from './components';
import { SCENES, type SceneId } from './scenes';
import { Grounding, Moderator, Orchestrator, Personas, Swarm, Voices } from './scenes/Design';
import { Alone, Brand, ForWho, Wall } from './scenes/Purpose';

export type IntroProps = { captions: boolean };

const COMPONENTS: Record<SceneId, React.FC> = {
  Alone, Wall, Brand, ForWho, Swarm, Personas, Orchestrator, Grounding, Moderator, Voices,
};

/** Parts 1-2 of the video (Purpose, Design). The demo recording is appended after it. */
export const Intro: React.FC<IntroProps> = ({ captions }) => (
  <Board>
    {SCENES.map((scene) => {
      const Scene = COMPONENTS[scene.id];
      return (
        <Sequence key={scene.id} from={scene.from} durationInFrames={scene.frames} name={`${scene.part}: ${scene.id}`}>
          {/* The last scene fades fully to the board color for a clean cut to the demo. */}
          <SceneFade frames={scene.frames} fadeOut={scene.id === 'Voices' ? 24 : 12}>
            <Scene />
          </SceneFade>
          {captions && <Caption text={scene.caption} frames={scene.frames} />}
        </Sequence>
      );
    })}
  </Board>
);

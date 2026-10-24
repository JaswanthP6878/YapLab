import { Composition, Still } from 'remotion';
import { Banner } from './Banner';
import { Intro, type IntroProps } from './Intro';
import { FPS, TOTAL_FRAMES } from './scenes';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="YapLabIntro"
      component={Intro}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ captions: true } satisfies IntroProps}
    />
    <Still id="Banner" component={Banner} width={1800} height={560} />
  </>
);

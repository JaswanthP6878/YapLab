import { loadFont as loadCaveat } from '@remotion/google-fonts/Caveat';
import { loadFont as loadHanken } from '@remotion/google-fonts/HankenGrotesk';
import { loadFont as loadPlex } from '@remotion/google-fonts/IBMPlexMono';
import { loadFont as loadSerif } from '@remotion/google-fonts/InstrumentSerif';

// Same palette and type as frontend/src/styles.css: a lecture hall at night.
export const colors = {
  board: '#121C19',
  board2: '#18251F',
  board3: '#203029',
  board4: '#2A3D35',
  line: 'rgba(226, 232, 214, 0.1)',
  line2: 'rgba(226, 232, 214, 0.18)',
  chalk: '#ECEEE3',
  chalk2: '#B3BDAF',
  chalk3: '#7C8A80',
  marigold: '#F2C14E',
  marigoldInk: '#241A02',
  marigoldSoft: 'rgba(242, 193, 78, 0.14)',
  mint: '#7FD1AE',
  coral: '#F07F64',
  sky: '#8EB8F0',
};

loadSerif('italic', { weights: ['400'], subsets: ['latin'] });
export const fonts = {
  display: loadSerif('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily,
  body: loadHanken('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] }).fontFamily,
  mono: loadPlex('normal', { weights: ['400', '500'], subsets: ['latin'] }).fontFamily,
  hand: loadCaveat('normal', { weights: ['500', '700'], subsets: ['latin'] }).fontFamily,
};

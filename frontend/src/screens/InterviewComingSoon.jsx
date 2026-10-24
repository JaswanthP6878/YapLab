import Icon from '../components/Icon.jsx';

export default function InterviewComingSoon({ onBack }) {
  return (
    <main className="wrap interview-coming-soon mode-interview">
      <button className="link-back" onClick={onBack}><Icon name="prev" size={16} /> Modes</button>
      <section className="coming-soon-panel" aria-labelledby="interview-heading">
        <h1 id="interview-heading">Upcoming soon</h1>
      </section>
    </main>
  );
}

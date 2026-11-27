import { NUMBERS_SECTIONS } from '../content/numbersCopy';
import { Body, Caption, Card, Heading, Screen } from '../ui/kit';

// "How the numbers work and their limits" (build plan Stage 9). The same
// text is published as docs/how-the-numbers-work.md.

export default function AboutNumbers() {
  return (
    <Screen>
      {NUMBERS_SECTIONS.map((s) => (
        <Card key={s.title}>
          <Heading>{s.title}</Heading>
          {s.body.map((p) => (
            <Body key={p}>{p}</Body>
          ))}
          {s.limits ? <Caption>Limits: {s.limits}</Caption> : null}
        </Card>
      ))}
    </Screen>
  );
}

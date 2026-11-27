import { PRIVACY_SECTIONS, PRIVACY_VERSION } from '../content/privacyCopy';
import { Body, Caption, Card, Heading, Screen } from '../ui/kit';

// The privacy policy (draft, D23); the same text is docs/privacy-policy.md.
export default function Privacy() {
  return (
    <Screen>
      <Caption>{PRIVACY_VERSION}</Caption>
      {PRIVACY_SECTIONS.map((s) => (
        <Card key={s.title}>
          <Heading>{s.title}</Heading>
          {s.body.map((p) => (
            <Body key={p}>{p}</Body>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

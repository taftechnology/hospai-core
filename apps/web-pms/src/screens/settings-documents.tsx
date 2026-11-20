import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { getConfigEntry } from '@hospai/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  NativeSelect,
  Textarea,
} from '@hospai/ui-kit';
import { api, asClassified } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import type { DomainKey } from './settings-domain-fields.js';

type CardShow = {
  ratePlan: boolean;
  inclusions: boolean;
  specialRequests: boolean;
  idDocument: boolean;
  signature: boolean;
};

type CardPresentation = {
  template: 'STANDARD' | 'COMPACT';
  headerText: string;
  footerText: string;
  show: CardShow;
};

type ProformaShow = {
  perNight: boolean;
  taxSummary: boolean;
  advances: boolean;
  warnings: boolean;
};

type ProformaPresentation = {
  template: 'STANDARD' | 'DETAILED';
  headerText: string;
  footerText: string;
  show: ProformaShow;
};

function lookup(keys: DomainKey[], key: string): unknown {
  return keys.find((k) => k.key === key)?.value;
}

function configValue(keys: DomainKey[], key: string): unknown {
  const stored = lookup(keys, key);
  if (stored !== undefined) return stored;
  return getConfigEntry(key)?.default;
}

function asCardPresentation(value: unknown): CardPresentation {
  const d = getConfigEntry('pms.documents.registration_card')?.default as CardPresentation;
  if (!value || typeof value !== 'object') return { ...d, show: { ...d.show } };
  const v = value as Partial<CardPresentation>;
  const show = (v.show ?? {}) as Partial<CardShow>;
  return {
    template: v.template === 'COMPACT' ? 'COMPACT' : 'STANDARD',
    headerText: typeof v.headerText === 'string' ? v.headerText : d.headerText,
    footerText: typeof v.footerText === 'string' ? v.footerText : d.footerText,
    show: {
      ratePlan: show.ratePlan ?? d.show.ratePlan,
      inclusions: show.inclusions ?? d.show.inclusions,
      specialRequests: show.specialRequests ?? d.show.specialRequests,
      idDocument: show.idDocument ?? d.show.idDocument,
      signature: show.signature ?? d.show.signature,
    },
  };
}

function asProformaPresentation(value: unknown): ProformaPresentation {
  const d = getConfigEntry('pms.documents.proforma')?.default as ProformaPresentation;
  if (!value || typeof value !== 'object') return { ...d, show: { ...d.show } };
  const v = value as Partial<ProformaPresentation>;
  const show = (v.show ?? {}) as Partial<ProformaShow>;
  return {
    template: v.template === 'DETAILED' ? 'DETAILED' : 'STANDARD',
    headerText: typeof v.headerText === 'string' ? v.headerText : d.headerText,
    footerText: typeof v.footerText === 'string' ? v.footerText : d.footerText,
    show: {
      perNight: show.perNight ?? d.show.perNight,
      taxSummary: show.taxSummary ?? d.show.taxSummary,
      advances: show.advances ?? d.show.advances,
      warnings: show.warnings ?? d.show.warnings,
    },
  };
}

function sameCard(a: CardPresentation, b: CardPresentation): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameProforma(a: ProformaPresentation, b: ProformaPresentation): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Settings → Documents (roadmap R4.13 B3). PRESENTATION keys for registration card + proforma.
 */
export function DocumentsSettings(props: {
  keys: DomainKey[];
  reason: string;
  propertyId: string;
  onSaved: () => void | Promise<void>;
  reasonControl: ReactNode;
}) {
  const storedCard = useMemo(
    () => asCardPresentation(configValue(props.keys, 'pms.documents.registration_card')),
    [props.keys],
  );
  const storedProforma = useMemo(
    () => asProformaPresentation(configValue(props.keys, 'pms.documents.proforma')),
    [props.keys],
  );

  const [cardDraft, setCardDraft] = useState(storedCard);
  const [proformaDraft, setProformaDraft] = useState(storedProforma);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  useEffect(() => setCardDraft(storedCard), [storedCard]);
  useEffect(() => setProformaDraft(storedProforma), [storedProforma]);

  const cardDirty = !sameCard(cardDraft, storedCard);
  const proformaDirty = !sameProforma(proformaDraft, storedProforma);
  const reasonOk = props.reason.trim().length > 0;

  const saveCard = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: 'pms.documents.registration_card',
        value: cardDraft,
        reason: props.reason,
      }),
    onSuccess: async () => {
      setError(null);
      setSuccessNotice('Registration card settings saved.');
      await props.onSaved();
    },
    onError: (err) => {
      setSuccessNotice(null);
      setError(
        classifiedUserMessage(asClassified(err), {
          fallback: 'Could not save registration card settings.',
        }),
      );
    },
  });

  const saveProforma = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: 'pms.documents.proforma',
        value: proformaDraft,
        reason: props.reason,
      }),
    onSuccess: async () => {
      setError(null);
      setSuccessNotice('Proforma settings saved.');
      await props.onSaved();
    },
    onError: (err) => {
      setSuccessNotice(null);
      setError(
        classifiedUserMessage(asClassified(err), {
          fallback: 'Could not save proforma settings.',
        }),
      );
    },
  });

  return (
    <>
      <Alert intent="attention">
        <span className="ui-alert__title">A reason is required before saving</span>
        <span>Every configuration change is written to the audit log with this note.</span>
      </Alert>
      <Card>
        <CardContent>{props.reasonControl}</CardContent>
      </Card>

      {error ? <Alert intent="exception">{error}</Alert> : null}
      {successNotice ? (
        <Alert intent="settled" data-testid="documents-success">
          {successNotice}
        </Alert>
      ) : null}

      {cardDirty && !reasonOk ? (
        <p className="muted settings-property__status">Enter a reason to save changes.</p>
      ) : null}

      <Card data-testid="documents-registration-card">
        <CardHeader>
          <CardTitle>Registration card</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            <Field
              label="Template"
              control={
                <NativeSelect
                  aria-label="Registration card template"
                  value={cardDraft.template}
                  onChange={(e) =>
                    setCardDraft({
                      ...cardDraft,
                      template: e.target.value === 'COMPACT' ? 'COMPACT' : 'STANDARD',
                    })
                  }
                >
                  <option value="STANDARD">Standard</option>
                  <option value="COMPACT">Compact</option>
                </NativeSelect>
              }
            />
            <Field
              label="Header text"
              control={
                <Input
                  aria-label="Registration card header"
                  value={cardDraft.headerText}
                  maxLength={200}
                  onChange={(e) => setCardDraft({ ...cardDraft, headerText: e.target.value })}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Footer text"
              control={
                <Textarea
                  aria-label="Registration card footer"
                  value={cardDraft.footerText}
                  maxLength={500}
                  onChange={(e) => setCardDraft({ ...cardDraft, footerText: e.target.value })}
                />
              }
            />
            <div className="settings-property__grid">
              <Field
                label="Show rate plan"
                control={
                  <Checkbox
                    checked={cardDraft.show.ratePlan}
                    onChange={(e) =>
                      setCardDraft({
                        ...cardDraft,
                        show: { ...cardDraft.show, ratePlan: e.target.checked },
                      })
                    }
                  />
                }
              />
              <Field
                label="Show inclusions"
                control={
                  <Checkbox
                    checked={cardDraft.show.inclusions}
                    onChange={(e) =>
                      setCardDraft({
                        ...cardDraft,
                        show: { ...cardDraft.show, inclusions: e.target.checked },
                      })
                    }
                  />
                }
              />
              <Field
                label="Show special requests"
                control={
                  <Checkbox
                    checked={cardDraft.show.specialRequests}
                    onChange={(e) =>
                      setCardDraft({
                        ...cardDraft,
                        show: { ...cardDraft.show, specialRequests: e.target.checked },
                      })
                    }
                  />
                }
              />
              <Field
                label="Show ID document"
                control={
                  <Checkbox
                    checked={cardDraft.show.idDocument}
                    onChange={(e) =>
                      setCardDraft({
                        ...cardDraft,
                        show: { ...cardDraft.show, idDocument: e.target.checked },
                      })
                    }
                  />
                }
              />
              <Field
                label="Show signature"
                control={
                  <Checkbox
                    checked={cardDraft.show.signature}
                    onChange={(e) =>
                      setCardDraft({
                        ...cardDraft,
                        show: { ...cardDraft.show, signature: e.target.checked },
                      })
                    }
                  />
                }
              />
            </div>
            <Button
              type="button"
              intent="primary"
              disabled={!cardDirty || !reasonOk || saveCard.isPending}
              onClick={() => {
                setSuccessNotice(null);
                saveCard.mutate();
              }}
            >
              Save registration card
            </Button>
          </div>
        </CardContent>
      </Card>

      {proformaDirty && !reasonOk ? (
        <p className="muted settings-property__status">Enter a reason to save changes.</p>
      ) : null}

      <Card data-testid="documents-proforma">
        <CardHeader>
          <CardTitle>Proforma</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            <Field
              label="Template"
              control={
                <NativeSelect
                  aria-label="Proforma template"
                  value={proformaDraft.template}
                  onChange={(e) =>
                    setProformaDraft({
                      ...proformaDraft,
                      template: e.target.value === 'DETAILED' ? 'DETAILED' : 'STANDARD',
                    })
                  }
                >
                  <option value="STANDARD">Standard</option>
                  <option value="DETAILED">Detailed</option>
                </NativeSelect>
              }
            />
            <Field
              label="Header text"
              control={
                <Input
                  aria-label="Proforma header"
                  value={proformaDraft.headerText}
                  maxLength={200}
                  onChange={(e) =>
                    setProformaDraft({ ...proformaDraft, headerText: e.target.value })
                  }
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Footer text"
              control={
                <Textarea
                  aria-label="Proforma footer"
                  value={proformaDraft.footerText}
                  maxLength={500}
                  onChange={(e) =>
                    setProformaDraft({ ...proformaDraft, footerText: e.target.value })
                  }
                />
              }
            />
            <div className="settings-property__grid">
              <Field
                label="Show per-night lines"
                control={
                  <Checkbox
                    checked={proformaDraft.show.perNight}
                    onChange={(e) =>
                      setProformaDraft({
                        ...proformaDraft,
                        show: { ...proformaDraft.show, perNight: e.target.checked },
                      })
                    }
                  />
                }
              />
              <Field
                label="Show tax summary"
                control={
                  <Checkbox
                    checked={proformaDraft.show.taxSummary}
                    onChange={(e) =>
                      setProformaDraft({
                        ...proformaDraft,
                        show: { ...proformaDraft.show, taxSummary: e.target.checked },
                      })
                    }
                  />
                }
              />
              <Field
                label="Show advances"
                control={
                  <Checkbox
                    checked={proformaDraft.show.advances}
                    onChange={(e) =>
                      setProformaDraft({
                        ...proformaDraft,
                        show: { ...proformaDraft.show, advances: e.target.checked },
                      })
                    }
                  />
                }
              />
              <Field
                label="Show warnings"
                control={
                  <Checkbox
                    checked={proformaDraft.show.warnings}
                    onChange={(e) =>
                      setProformaDraft({
                        ...proformaDraft,
                        show: { ...proformaDraft.show, warnings: e.target.checked },
                      })
                    }
                  />
                }
              />
            </div>
            <Button
              type="button"
              intent="primary"
              disabled={!proformaDirty || !reasonOk || saveProforma.isPending}
              onClick={() => {
                setSuccessNotice(null);
                saveProforma.mutate();
              }}
            >
              Save proforma
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  NativeSelect,
  PageHeader,
  Skeleton,
} from '@hospai/ui-kit';
import { meShellStateFromQuery } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import {
  asRegistrationCardPresentation,
  PrintDocumentControl,
  RegistrationCardDocument,
  type RegistrationCardData,
} from './registration-card.js';
import {
  asProformaPresentation,
  ProformaDocument,
  type ProformaData,
} from './proforma-document.js';

export function resolveDocumentPrintGate(input: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  okPayload: boolean;
  authorityLive: boolean;
}): { canPrint: boolean; reason: string | null } {
  if (input.isPending) {
    return { canPrint: false, reason: 'Document is still loading.' };
  }
  if (input.isError) {
    const c = asClassified(input.error);
    if (c.class === 'fail_closed') {
      return { canPrint: false, reason: 'Property unreachable — printing is disabled.' };
    }
    return {
      canPrint: false,
      reason: classifiedUserMessage(c, { fallback: 'Document could not be loaded.' }),
    };
  }
  if (!input.authorityLive) {
    return { canPrint: false, reason: 'Property unreachable — printing is disabled.' };
  }
  if (!input.isSuccess || !input.okPayload) {
    return { canPrint: false, reason: 'Document is unavailable.' };
  }
  return { canPrint: true, reason: null };
}

function useAuthorityLive(): boolean {
  const meQ = useQuery({
    queryKey: ['me', tenant.propertyId],
    queryFn: () => api.getMe(tenant.propertyId),
    retry: false,
  });
  const shell = meShellStateFromQuery({
    status: meQ.status,
    data: meQ.data,
    classified: meQ.error ? asClassified(meQ.error) : undefined,
  });
  return shell.kind === 'authority' && shell.authority.kind === 'live';
}

function usePropertyName(): string | null {
  const propertyQ = useQuery({
    queryKey: ['property', tenant.propertyId],
    queryFn: () => api.getProperty(tenant.propertyId),
    retry: false,
  });
  return propertyQ.data?.property?.name ?? null;
}

function isOkCard(body: unknown): body is RegistrationCardData {
  return Boolean(body && typeof body === 'object' && (body as { ok?: unknown }).ok === true);
}

function isOkProforma(body: unknown): body is ProformaData {
  return Boolean(body && typeof body === 'object' && (body as { ok?: unknown }).ok === true);
}

export function RegistrationCardPrintView() {
  const { reservationId = '' } = useParams();
  const propertyId = tenant.propertyId;
  const propertyName = usePropertyName();
  const authorityLive = useAuthorityLive();
  const [template, setTemplate] = useState<'STANDARD' | 'COMPACT' | ''>('');

  const cardQ = useQuery({
    queryKey: ['reservation-registration-card', propertyId, reservationId],
    queryFn: () => api.getReservationRegistrationCard(propertyId, reservationId),
    staleTime: 0,
    enabled: Boolean(reservationId),
    retry: false,
  });

  const cardData = isOkCard(cardQ.data) ? cardQ.data : null;
  const okPayload = cardData !== null;
  const gate = resolveDocumentPrintGate({
    isPending: cardQ.isPending,
    isError: cardQ.isError,
    isSuccess: cardQ.isSuccess,
    error: cardQ.error,
    okPayload,
    authorityLive,
  });

  const storedTemplate = asRegistrationCardPresentation(cardData?.presentation).template;
  const effectiveTemplate = template || storedTemplate;

  return (
    <div className="ui-page-stack print-view" data-testid="registration-card-print-view">
      <PageHeader
        title="Registration card"
        subtitle={propertyName}
        back={
          <Link to={`/reservations/${encodeURIComponent(reservationId)}`}>Reservation</Link>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Print</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            <Field
              label="Template"
              control={
                <NativeSelect
                  data-testid="document-template"
                  value={effectiveTemplate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTemplate(v === 'COMPACT' ? 'COMPACT' : 'STANDARD');
                  }}
                >
                  <option value="STANDARD">Standard</option>
                  <option value="COMPACT">Compact</option>
                </NativeSelect>
              }
            />
            <PrintDocumentControl canPrint={gate.canPrint} reason={gate.reason} label="Print" />
            {cardQ.isError ? (
              <Alert intent="exception">
                {classifiedUserMessage(asClassified(cardQ.error), {
                  fallback: 'Could not load the registration card.',
                })}
              </Alert>
            ) : null}
            {cardQ.isPending ? <Skeleton /> : null}
          </div>
        </CardContent>
      </Card>
      {cardData && !cardQ.isError ? (
        <RegistrationCardDocument
          propertyName={propertyName}
          data={cardData}
          templateOverride={effectiveTemplate}
        />
      ) : null}
    </div>
  );
}

export function ProformaPrintView() {
  const { reservationId = '' } = useParams();
  const propertyId = tenant.propertyId;
  const propertyName = usePropertyName();
  const authorityLive = useAuthorityLive();
  const [template, setTemplate] = useState<'STANDARD' | 'DETAILED' | ''>('');

  const proformaQ = useQuery({
    queryKey: ['reservation-proforma', propertyId, reservationId],
    queryFn: () => api.getReservationProforma(propertyId, reservationId),
    staleTime: 0,
    enabled: Boolean(reservationId),
    retry: false,
  });

  const proformaData = isOkProforma(proformaQ.data) ? proformaQ.data : null;
  const okPayload = proformaData !== null;
  const gate = resolveDocumentPrintGate({
    isPending: proformaQ.isPending,
    isError: proformaQ.isError,
    isSuccess: proformaQ.isSuccess,
    error: proformaQ.error,
    okPayload,
    authorityLive,
  });

  const storedTemplate = asProformaPresentation(proformaData?.presentation).template;
  const effectiveTemplate = template || storedTemplate;

  return (
    <div className="ui-page-stack print-view" data-testid="proforma-print-view">
      <PageHeader
        title="Proforma"
        subtitle={propertyName}
        back={
          <Link to={`/reservations/${encodeURIComponent(reservationId)}`}>Reservation</Link>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Print</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            <Field
              label="Template"
              control={
                <NativeSelect
                  data-testid="document-template"
                  value={effectiveTemplate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTemplate(v === 'DETAILED' ? 'DETAILED' : 'STANDARD');
                  }}
                >
                  <option value="STANDARD">Standard</option>
                  <option value="DETAILED">Detailed</option>
                </NativeSelect>
              }
            />
            <PrintDocumentControl canPrint={gate.canPrint} reason={gate.reason} label="Print" />
            {proformaQ.isError ? (
              <Alert intent="exception">
                {classifiedUserMessage(asClassified(proformaQ.error), {
                  fallback: 'Could not load the proforma.',
                })}
              </Alert>
            ) : null}
            {proformaQ.isPending ? <Skeleton /> : null}
          </div>
        </CardContent>
      </Card>
      {proformaData && !proformaQ.isError ? (
        <ProformaDocument
          propertyName={propertyName}
          data={proformaData}
          templateOverride={effectiveTemplate}
        />
      ) : null}
    </div>
  );
}

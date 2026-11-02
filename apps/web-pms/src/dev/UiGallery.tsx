import { useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Dialog,
  EmptyState,
  Field,
  FieldGroup,
  Input,
  LinkButton,
  NativeSelect,
  Popover,
  CountStrip,
  DateRange,
  RoomStatus,
  Separator,
  Skeleton,
  StatField,
  StatusBadge,
  Textarea,
} from '@hospai/ui-kit';

export function UiGallery() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverAnchorRef = useRef<HTMLButtonElement>(null);

  return (
    <Card className="ui-stack">
      <h1>UI kit gallery</h1>

      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-row">
            <Button intent="default">Default</Button>
            <Button intent="primary">Primary</Button>
            <Button intent="destructive">Destructive</Button>
            <Button intent="ghost">Ghost</Button>
            <Button intent="primary" size="sm">
              Small
            </Button>
            <Button intent="primary" disabled>
              Disabled
            </Button>
          </div>
          <div className="ui-row">
            <LinkButton href="#buttons" intent="primary">
              Link button
            </LinkButton>
            <LinkButton href="#buttons" intent="ghost" disabled>
              Link disabled
            </LinkButton>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dialog</CardTitle>
        </CardHeader>
        <CardContent>
          <Button type="button" intent="primary" onClick={() => setDialogOpen(true)}>
            Open sample dialog
          </Button>
          <Dialog
            open={dialogOpen}
            title="Sample dialog"
            onClose={() => setDialogOpen(false)}
            footer={
              <>
                <Button type="button" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" intent="primary" onClick={() => setDialogOpen(false)}>
                  Confirm
                </Button>
              </>
            }
          >
            <p className="muted">Dialog body copy for the gallery.</p>
          </Dialog>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Popover</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            ref={popoverAnchorRef}
            onClick={() => setPopoverOpen((open) => !open)}
          >
            Open sample popover
          </Button>
          <Popover
            open={popoverOpen}
            onClose={() => setPopoverOpen(false)}
            anchorRef={popoverAnchorRef}
            label="Sample popover"
          >
            <p className="muted">Popover body for the gallery. Escape or a click outside closes it.</p>
          </Popover>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Field groups</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup legend="Filters">
            <div className="ui-choice-row">
              <label className="ui-choice">
                <Checkbox defaultChecked aria-label="Option A" />
                Option A
              </label>
              <label className="ui-choice">
                <Checkbox aria-label="Option B" />
                Option B
              </label>
            </div>
          </FieldGroup>
          <FieldGroup inline legend="Inline row">
            <Field label="From" control={<Input type="date" defaultValue="2026-08-14" />} />
            <Field label="To" control={<Input type="date" defaultValue="2026-08-16" />} />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fields</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Text" control={<Input type="text" defaultValue="Ada" />} />
          <Field label="Date" control={<Input type="date" defaultValue="2026-08-14" />} />
          <Field label="Number" control={<Input type="number" defaultValue="2" />} />
          <Field
            label="Select"
            control={
              <NativeSelect defaultValue="a">
                <option value="a">Option A</option>
                <option value="b">Option B</option>
              </NativeSelect>
            }
          />
          <Field label="Textarea" control={<Textarea defaultValue="Notes" />} />
          <Field label="Checkbox" control={<Checkbox defaultChecked aria-label="Agree" />} />
          <Field
            label="With error"
            error="Required"
            control={<Input type="text" aria-invalid />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data table</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Guest</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              <DataTableRow>
                <DataTableCell>Ada Lovelace</DataTableCell>
                <DataTableCell>
                  <Badge rung="settled">Paid</Badge>
                </DataTableCell>
              </DataTableRow>
            </DataTableBody>
          </DataTable>
        </CardContent>
        <CardFooter>Footer slot</CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>Something needs attention</Alert>
          <Separator />
          <Skeleton width="12rem" height="1rem" data-testid="gallery-skeleton" />
          <EmptyState kind="empty" title="Nothing here yet." />
          <EmptyState kind="nomatch" title="No rows match that filter." />
          <EmptyState kind="error" title="Could not load this panel." />
          <div className="ui-row">
            <Badge rung="neutral">Neutral</Badge>
            <Badge rung="informational">Info</Badge>
            <Badge rung="attention">Attention</Badge>
            <Badge rung="exception">Exception</Badge>
          </div>
          <div className="ui-row">
            <StatusBadge status="inquiry" />
            <StatusBadge status="pending" />
            <StatusBadge status="confirmed" vip />
            <StatusBadge status="checked_in" />
            <StatusBadge status="checked_out" />
            <StatusBadge status="cancelled" />
            <StatusBadge status="no_show" />
          </div>
          <div className="ui-row">
            <RoomStatus status="clean" />
            <RoomStatus status="dirty" />
            <RoomStatus status="inspected" />
            <RoomStatus status="out_of_order" />
            <RoomStatus status="mystery" />
          </div>
          <StatField label="Vacant, not out of order" value="20" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CountStrip &amp; DateRange</CardTitle>
        </CardHeader>
        <CardContent>
          <CountStrip label="Sample counts">
            <span className="ui-count">
              <b>4</b> arrivals
            </span>
            <span className="ui-count ui-count--odd">
              <b>1</b> overstay
            </span>
          </CountStrip>
          <DateRange
            label="Sample range"
            from="2026-08-10"
            to="2026-08-16"
            stepDays={7}
            onChange={() => {}}
          />
        </CardContent>
      </Card>
    </Card>
  );
}

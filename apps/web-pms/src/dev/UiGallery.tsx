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
  Field,
  Input,
  LinkButton,
  NativeSelect,
  RoomStatus,
  Separator,
  Skeleton,
  StatField,
  StatusBadge,
  Textarea,
} from '@hospai/ui-kit';

export function UiGallery() {
  return (
    <Card className="stack">
      <h1>UI kit gallery</h1>

      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="stack-row">
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
          <div className="stack-row">
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
          <div className="stack-row">
            <Badge rung="neutral">Neutral</Badge>
            <Badge rung="informational">Info</Badge>
            <Badge rung="attention">Attention</Badge>
            <Badge rung="exception">Exception</Badge>
          </div>
          <div className="stack-row">
            <StatusBadge status="inquiry" />
            <StatusBadge status="pending" />
            <StatusBadge status="confirmed" vip />
            <StatusBadge status="checked_in" />
            <StatusBadge status="checked_out" />
            <StatusBadge status="cancelled" />
            <StatusBadge status="no_show" />
          </div>
          <div className="stack-row">
            <RoomStatus status="clean" />
            <RoomStatus status="dirty" />
            <RoomStatus status="inspected" />
            <RoomStatus status="out_of_order" />
            <RoomStatus status="mystery" />
          </div>
          <StatField label="Vacant, not out of order" value="20" />
        </CardContent>
      </Card>
    </Card>
  );
}

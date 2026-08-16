"use client";

import { useParams } from "next/navigation";
import { useOrgChart } from "@/hooks/useEmployment";
import { RoleGate } from "@/components/auth/RoleGate";
import { EMPLOYMENT_STATUS_TONE, EMPLOYMENT_STATUS_LABEL } from "@/lib/employmentStatus";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TextLink,
} from "@/components/ui";

function OrgChart() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: chart, isLoading, error } = useOrgChart(id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <TextLink href={`/hotel-groups/${id}`} className="text-sm">
        ← Back to hotel group
      </TextLink>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            {/* CRR §1:23 / ADR-060 — visible only to the group's own Regional
                Manager and Admin; a scope mismatch surfaces as a 403 here. */}
            Failed to load this org chart. You may not have access to this
            group.
          </CardContent>
        </Card>
      ) : isLoading || !chart ? (
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          <PageHeader title={`${chart.name} — org chart`} />

          <Card>
            <CardHeader>
              <CardTitle>{t("roles.regionalManager")}</CardTitle>
            </CardHeader>
            <CardContent className="py-2 text-sm">
              {chart.regional_manager ? (
                <>
                  {chart.regional_manager.first_name}{" "}
                  {chart.regional_manager.last_name}{" "}
                  <span className="text-gray-500 dark:text-gray-400">
                    ({chart.regional_manager.email})
                  </span>
                </>
              ) : (
                <span className="text-gray-500 dark:text-gray-400">{t("status.unassigned")}</span>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hotels ({chart.hotels.length})</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              {chart.hotels.length === 0 ? (
                <EmptyState
                  title={t("hotelGroups.noHotelsInGroup")}
                  description={t("hotelGroups.assignHotelsHint")}
                />
              ) : (
                <Table aria-label={t("hotels.inThisGroup")}>
                  <THead>
                    <TR>
                      <TH>{t("fields.hotel")}</TH>
                      <TH>{t("roles.manager")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {chart.hotels.map((h) => (
                      <TR key={h.id}>
                        <TD>{h.name}</TD>
                        <TD>
                          {h.manager ? (
                            `${h.manager.first_name} ${h.manager.last_name}`
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">{t("status.unassigned")}</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Group-grain (REQ-EMP-012): employees are listed once here, not
              nested under any one hotel in the table above — the data model
              has no hotel_id on an EmploymentRecord. */}
          <Card>
            <CardHeader>
              <CardTitle>Employees ({chart.employees.length})</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              {chart.employees.length === 0 ? (
                <EmptyState
                  title={t("hotelGroups.noEmployees")}
                  description={t("hotelGroups.noEmployeesDescription")}
                />
              ) : (
                <Table aria-label={t("hotelGroups.employeesInGroup")}>
                  <THead>
                    <TR>
                      <TH>{t("fields.name")}</TH>
                      <TH>{t("fields.jobTitle")}</TH>
                      <TH>{t("fields.status")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {chart.employees.map((e) => (
                      <TR key={e.employee_id}>
                        <TD>
                          {e.user.first_name} {e.user.last_name}
                        </TD>
                        <TD>{e.job_title}</TD>
                        <TD>
                          <Badge tone={EMPLOYMENT_STATUS_TONE[e.status]}>
                            {EMPLOYMENT_STATUS_LABEL[e.status]}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export default function OrgChartPage() {
  return (
    // CRR §1:23 / ADR-060 / ADR-030 §3 C-33: org chart visible ONLY to
    // Regional Manager (their own group, enforced service-side) and Admin.
    <RoleGate
      allow={["admin", "regional_manager"]}
      fallback={
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              Only Admins and Regional Managers can view org charts.
            </CardContent>
          </Card>
        </div>
      }
    >
      <OrgChart />
    </RoleGate>
  );
}

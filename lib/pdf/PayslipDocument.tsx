import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import type { ReactNode } from "react";
import { DEDUCTION_ITEMS, formatHours, formatWon, type Payslip } from "@/lib/payroll";

// 좌표·크기는 기존 임금명세서 PDF(A4, pt 단위)를 기준으로 맞춤
const THIN = 0.75;
const THICK = 1.5;
const GRAY = "#d3d3d3";

// 세부 내역: 임금 항목 | 지급 금액 | 공제 항목 | 공제 금액
const DETAIL_COLS = ["17.86%", "25.82%", "20.05%", "36.27%"];
// 계산 방법: 구분 | 산출식 | (빈칸) | 지급액
const CALC_COLS = ["26.19%", "46.43%", "10.71%", "16.67%"];

const ITEM_ROW_H = 29.2;
const ROW_H = 26.3;

const s = StyleSheet.create({
  page: {
    paddingTop: 53,
    paddingHorizontal: 24.5,
    fontSize: 10.5,
    color: "#000",
  },
  frame: { borderWidth: THICK, borderColor: "#000" },
  row: { flexDirection: "row" },
  cell: {
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    borderColor: "#000",
  },
  bold: { fontWeight: 700 },
  title: { fontSize: 15, fontWeight: 700, textAlign: "center" },
});

function Row({
  height,
  top,
  bottom = true,
  gray,
  children,
}: {
  height: number;
  top?: boolean;
  bottom?: boolean;
  gray?: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={[
        s.row,
        { height },
        top ? { borderTopWidth: THIN } : {},
        bottom ? { borderBottomWidth: THIN } : {},
        gray ? { backgroundColor: GRAY } : {},
      ]}
    >
      {children}
    </View>
  );
}

function Cell({
  width,
  last,
  bold,
  align = "center",
  style,
  children,
}: {
  width: string;
  last?: boolean;
  bold?: boolean;
  align?: "center" | "left";
  style?: Style;
  children?: ReactNode;
}) {
  return (
    <View
      style={[
        s.cell,
        { width, borderRightWidth: last ? 0 : THIN },
        align === "left" ? { alignItems: "flex-start" } : {},
        style ?? {},
      ]}
    >
      {children !== undefined && children !== "" ? <Text style={bold ? s.bold : {}}>{children}</Text> : null}
    </View>
  );
}

function SectionHeader({ children }: { children: string }) {
  return (
    <Row height={27.5} top gray>
      <Cell width="100%" last>
        {children}
      </Cell>
    </Row>
  );
}

export function PayslipPage({ slip, fontFamily }: { slip: Payslip; fontFamily: string }) {
  const deductions: Record<(typeof DEDUCTION_ITEMS)[number], number | null> = {
    근로소득세: null,
    국민연금: null,
    건강보험: null,
    장기요양보험: null,
    고용보험: slip.employmentInsurance,
  };
  const [c1, c2, c3, c4] = DETAIL_COLS;

  return (
    <Page size="A4" style={[s.page, { fontFamily }]}>
      <View style={s.frame}>
        {/* 제목 */}
        <View style={{ height: 25 }} />
        <View style={{ height: 42, justifyContent: "center" }}>
          <Text style={s.title}>임 금 명 세 서</Text>
        </View>
        <View style={[s.row, { height: 25, justifyContent: "flex-end", alignItems: "center" }]}>
          <Text style={{ marginRight: 30 }}>지급일 :</Text>
          <Text style={{ width: 62, textAlign: "right", paddingRight: 3 }}>{slip.payDate}</Text>
        </View>

        {/* 성명 */}
        <View style={[s.row, { height: 29 }]}>
          <View
            style={[s.row, { width: "36.6%", borderTopWidth: THIN, borderBottomWidth: THIN, borderRightWidth: THIN }]}
          >
            <Cell width="48.75%">성명</Cell>
            <Cell width="51.25%" last align="left">
              {slip.name}
            </Cell>
          </View>
        </View>
        <View style={{ height: 16.5 }} />

        {/* 세부 내역 */}
        <SectionHeader>세부 내역</SectionHeader>
        <Row height={26}>
          <Cell width="43.68%">지{"    "}급</Cell>
          <Cell width="56.32%" last>
            공{"    "}제
          </Cell>
        </Row>
        <Row height={26.5}>
          <Cell width={c1}>임금 항목</Cell>
          <Cell width={c2}>지급 금액(원)</Cell>
          <Cell width={c3}>공제 항목</Cell>
          <Cell width={c4} last>
            공제 금액(원)
          </Cell>
        </Row>
        {DEDUCTION_ITEMS.map((item, i) => {
          const amount = deductions[item];
          return (
            <Row key={item} height={ITEM_ROW_H}>
              <Cell width={c1}>{i === 0 ? "기본급" : ""}</Cell>
              <Cell width={c2}>{i === 0 ? formatWon(slip.basePay) : ""}</Cell>
              <Cell width={c3}>{item}</Cell>
              <Cell width={c4} last>
                {amount ? formatWon(amount) : ""}
              </Cell>
            </Row>
          );
        })}
        <Row height={26.5}>
          <Cell width={c1} bold>
            지급액 계
          </Cell>
          <Cell width={c2} bold>
            {formatWon(slip.totalPay)}
          </Cell>
          <Cell width={c3}>공제액 계</Cell>
          <Cell width={c4} last>
            {formatWon(slip.totalDeduction)}
          </Cell>
        </Row>
        <Row height={26} bottom={false}>
          <Cell width="43.68%" />
          <Cell width={c3} bold style={{ borderBottomWidth: THIN }}>
            실지급액
          </Cell>
          <Cell width={c4} last bold style={{ borderBottomWidth: THIN }}>
            {formatWon(slip.netPay)}
          </Cell>
        </Row>
        <View style={{ height: 19 }} />

        {/* 계산 방법 */}
        <SectionHeader>계산 방법</SectionHeader>
        <Row height={26.5}>
          <Cell width={CALC_COLS[0]}>구분</Cell>
          <Cell width={CALC_COLS[1]}>산출식 또는 산출방법</Cell>
          <Cell width={CALC_COLS[2]} />
          <Cell width={CALC_COLS[3]} last>
            지급액(원)
          </Cell>
        </Row>
        <Row height={ROW_H}>
          <Cell width={CALC_COLS[0]}>기본급</Cell>
          <Cell width={CALC_COLS[1]}>
            {`${formatHours(slip.hours)} 시간 X ${formatWon(slip.hourlyWage)} 원`}
          </Cell>
          <Cell width={CALC_COLS[2]} />
          <Cell width={CALC_COLS[3]} last>
            {formatWon(slip.basePay)}
          </Cell>
        </Row>
        <Row height={ROW_H} bottom={false}>
          <Cell width={CALC_COLS[0]} />
          <Cell width={CALC_COLS[1]} />
          <Cell width={CALC_COLS[2]} />
          <Cell width={CALC_COLS[3]} last />
        </Row>
      </View>
    </Page>
  );
}

export function PayslipDocument({ slip, fontFamily }: { slip: Payslip; fontFamily: string }) {
  return (
    <Document title={`임금명세서 - ${slip.name}`} language="ko">
      <PayslipPage slip={slip} fontFamily={fontFamily} />
    </Document>
  );
}

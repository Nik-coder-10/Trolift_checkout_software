import { afterEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design;
// bypass that guard here so server logic is unit-testable (the guard
// still applies to real client bundles via the Next compiler).
vi.mock("server-only", () => ({}));
import {
  getBankDetails,
  getDeliveryGstRate,
  getDeliverySac,
  getQuotationAbout,
  getQuotationLogoPath,
  getQuotationTerms,
  getQuotationValidityDays,
  getSignatory,
  getSignatorySignPath,
} from "@/lib/quotations/config";
import { amountInWords, rupeesInWords } from "@/lib/quotations/words";
import {
  buildQuotationData,
  canIssueQuotation,
  formatQuotationNumber,
  type BuildQuotationInput,
} from "@/lib/quotations/data";

const BUSINESS = {
  name: "Trolift Solutions",
  address: "14 Industrial Estate, Mumbai 400001",
  phone: "+919810000000",
  email: "sales@trolift.in",
  gstin: "27ABCDE1234F1Z0",
};

const BANK = {
  bankName: "HDFC BANK LTD",
  accountName: "TROLIFT SOLUTIONS",
  accountNumber: "50200110000011",
  ifsc: "HDFC0000001",
  accountType: "CURRENT",
};

const SIGNATORY = { name: "Test Signatory", title: "Proprietor" };

const TERMS = [
  "Above quoted prices are Exclusive of GST @18% on Ladder and 5 % On Trolley",
  "Freight Charges Shall be Extra as Actual",
  "Payment Terms:- 100% Advance along with the Order Confirmation",
  "Delivery Terms:- 2-5 days after confirmation of payment in bank account",
  "Quotation is valid only for 7 Days from the date.",
];

const BILLING_DELHI = {
  name: "Acme Pvt Ltd",
  addressLine: "14 Industrial Estate",
  city: "South West Delhi",
  state: "Delhi",
  stateCode: "07",
  pincode: "110075",
};

/** Reference quotation 1: Delhi (inter-state), goods + taxed cartage. */
function refInput(over: Partial<BuildQuotationInput> = {}): BuildQuotationInput {
  return {
    quotationNumber: "QTN-TS0000121264",
    quotationDate: "2026-10-09",
    validTill: "2026-10-16",
    orderNumber: "TS-261009-0001",
    orderCreatedAt: "2026-10-09T10:00:00Z",
    orderStatus: "pending_payment",
    paymentMethod: "upi",
    business: { ...BUSINESS },
    bank: { ...BANK },
    signatory: { ...SIGNATORY },
    terms: [...TERMS],
    placeOfSupply: "Delhi",
    customer: {
      name: "Acme Pvt Ltd",
      phone: "+919810001111",
      email: null,
      gstin: "07ABCDE1234F1Z2",
    },
    billing: { ...BILLING_DELHI },
    shipping: {
      name: "Acme Pvt Ltd",
      phone: "+919810001111",
      pincode: "110075",
      partnerName: "Partner A",
    },
    items: [
      {
        name: "Metal Trolley 600 Kg",
        description: "Metal Trolley 600 Kg",
        quantity: 1,
        unitPricePaise: 505000,
        lineTotalPaise: 505000,
        gstRate: "5.00",
        lineTaxPaise: 25250,
        hsn: "87168010",
      },
    ],
    cartage: {
      name: "Cartage - delivery charge",
      description: "Delivery Fees through Our Designated Delivery Partners",
      chargePaise: 47000,
      sac: null,
      gstRate: "18.00",
      taxPaise: 8460,
    },
    totals: {
      treatment: "gst",
      subtotalPaise: 552000,
      deliveryPaise: 47000,
      deliveryTaxPaise: 8460,
      taxablePaise: 505000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 33710,
      grandTotalPaise: 585710,
    },
    ...over,
  };
}

describe("amount in words (Indian system)", () => {
  it("renders whole rupees and paise exactly", () => {
    expect(amountInWords(585710)).toBe(
      "Indian Rupee Five Thousand Eight Hundred Fifty Seven and Paise Ten Only",
    );
    expect(amountInWords(563650)).toBe(
      "Indian Rupee Five Thousand Six Hundred Thirty Six and Paise Fifty Only",
    );
    expect(amountInWords(15000)).toBe("Indian Rupee One Hundred Fifty Only");
    expect(amountInWords(0)).toBe("Indian Rupee Zero Only");
  });

  it("groups lakh and crore correctly", () => {
    expect(rupeesInWords(100000)).toBe("One Lakh");
    expect(rupeesInWords(2500000)).toBe("Twenty Five Lakh");
    expect(rupeesInWords(12345678)).toBe(
      "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight",
    );
  });

  it("rejects non-integers and negatives", () => {
    expect(() => amountInWords(-1)).toThrow();
    expect(() => amountInWords(10.5)).toThrow();
    expect(() => rupeesInWords(-100)).toThrow();
  });

  it("extends grouping past crore and fails closed beyond Kharab", () => {
    expect(rupeesInWords(1000000000)).toBe("One Arab");
    expect(rupeesInWords(100000000000)).toBe("One Kharab");
    expect(rupeesInWords(250000000000)).toBe("Two Kharab Fifty Arab");
    expect(amountInWords(100000000000)).toBe("Indian Rupee One Arab Only");
    // 10^13 rupees needs a group beyond Kharab — refuse, never wrong words.
    expect(() => rupeesInWords(10000000000000)).toThrow(/range/);
    expect(() => amountInWords(Number.MAX_SAFE_INTEGER)).toThrow();
  });
});

describe("quotation configuration", () => {
  afterEach(() => {
    for (const k of [
      "QUOTATION_VALIDITY_DAYS",
      "TROLIFT_DELIVERY_GST_RATE",
      "TROLIFT_DELIVERY_SAC",
      "TROLIFT_BANK_ACCOUNT_NO",
      "TROLIFT_BANK_NAME",
      "TROLIFT_SIGNATORY_NAME",
      "TROLIFT_SIGNATORY_TITLE",
      "TROLIFT_SIGNATORY_SIGN_PATH",
      "TROLIFT_QUOTATION_LOGO_PATH",
      "TROLIFT_QUOTATION_TERMS",
      "TROLIFT_QUOTATION_ABOUT",
    ]) delete process.env[k];
  });

  it("defaults validity to 7 days and rejects garbage", async () => {
    expect(await getQuotationValidityDays()).toBe(7);
    process.env.QUOTATION_VALIDITY_DAYS = "15";
    expect(await getQuotationValidityDays()).toBe(15);
    process.env.QUOTATION_VALIDITY_DAYS = "nonsense";
    expect(await getQuotationValidityDays()).toBe(7);
  });

  it("defaults cartage GST to 18% and fails safe on garbage", () => {
    expect(getDeliveryGstRate()).toBe("18.00");
    process.env.TROLIFT_DELIVERY_GST_RATE = "5";
    expect(getDeliveryGstRate()).toBe("5");
    process.env.TROLIFT_DELIVERY_GST_RATE = "bogus";
    expect(getDeliveryGstRate()).toBe("18.00");
  });

  it("accepts only 6-digit SAC codes", () => {
    expect(getDeliverySac()).toBeNull();
    process.env.TROLIFT_DELIVERY_SAC = "996511";
    expect(getDeliverySac()).toBe("996511");
    process.env.TROLIFT_DELIVERY_SAC = "abc";
    expect(getDeliverySac()).toBeNull();
  });

  it("omits bank and signatory blocks when unconfigured", () => {
    expect(getBankDetails()).toBeNull();
    expect(getSignatory()).toBeNull();
    process.env.TROLIFT_BANK_ACCOUNT_NO = "50200110000011";
    process.env.TROLIFT_BANK_NAME = "HDFC BANK LTD";
    expect(getBankDetails()).toMatchObject({ accountNumber: "50200110000011" });
    process.env.TROLIFT_SIGNATORY_NAME = "Test Signatory";
    expect(getSignatory()).toEqual({ name: "Test Signatory", title: null });
  });

  it("ships standard terms with newline override", () => {
    expect(getQuotationTerms()).toHaveLength(5);
    process.env.TROLIFT_QUOTATION_TERMS = "Custom one\nCustom two";
    expect(getQuotationTerms()).toEqual(["Custom one", "Custom two"]);
  });

  it("defaults the artwork paths inside public/ and rejects traversal", () => {
    expect(getQuotationLogoPath()).toBe("images/logo.png");
    expect(getSignatorySignPath()).toBe("images/proprietor-sign.png");
    process.env.TROLIFT_QUOTATION_LOGO_PATH = "images/custom-logo.png";
    expect(getQuotationLogoPath()).toBe("images/custom-logo.png");
    process.env.TROLIFT_SIGNATORY_SIGN_PATH = "../outside.png";
    expect(getSignatorySignPath()).toBe("images/proprietor-sign.png");
    process.env.TROLIFT_QUOTATION_LOGO_PATH = "..\\..\\evil.png";
    expect(getQuotationLogoPath()).toBe("images/logo.png");
  });

  it("ships the About Trolift copy with newline override", () => {
    expect(getQuotationAbout()).toContain("Trolift Solutions");
    process.env.TROLIFT_QUOTATION_ABOUT = "Para one\nPara two";
    expect(getQuotationAbout()).toBe("Para one Para two");
    process.env.TROLIFT_QUOTATION_ABOUT = "  \n ";
    expect(getQuotationAbout()).toContain("Trolift Solutions");
  });
});

describe("quotation builder (reference vectors)", () => {
  it("builds the inter-state reference quotation exactly", () => {
    const q = buildQuotationData(refInput());
    expect(q.kind).toBe("quotation");
    expect(q.items).toHaveLength(1);
    expect(q.items[0]?.lineTotalPaise).toBe(505000 + 25250);
    expect(q.cartage.lineTotalPaise).toBe(47000 + 8460);
    expect(q.totals.totalTaxPaise).toBe(33710);
    expect(q.totals.grandTotalPaise).toBe(585710);
  });

  it("builds the second reference quotation exactly", () => {
    const q = buildQuotationData(
      refInput({
        quotationNumber: "QTN-TS0000121265",
        quotationDate: "2026-10-10",
        validTill: "2026-10-17",
        items: [
          {
            name: "Trolift Foldable Platform Trolley",
            description: "600 Kg Load",
            quantity: 1,
            unitPricePaise: 475000,
            lineTotalPaise: 475000,
            gstRate: "5.00",
            lineTaxPaise: 23750,
            hsn: "87168010",
          },
        ],
        cartage: {
          name: "Cartage - delivery charge",
          description: "Delivery Fees",
          chargePaise: 55000,
          sac: null,
          gstRate: "18.00",
          taxPaise: 9900,
        },
        totals: {
          treatment: "gst",
          subtotalPaise: 530000,
          deliveryPaise: 55000,
          deliveryTaxPaise: 9900,
          taxablePaise: 475000,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 33650,
          grandTotalPaise: 563650,
        },
      }),
    );
    expect(q.totals.grandTotalPaise).toBe(563650);
  });

  it("splits cartage GST into CGST+SGST for same-state orders", () => {
    // Goods 1259800 @18% → 226764; cartage 45000 @18% → 8100 (even split).
    const q = buildQuotationData(
      refInput({
        billing: { ...BILLING_DELHI, state: "Maharashtra", stateCode: "27" },
        placeOfSupply: "Maharashtra",
        items: [
          {
            name: "Heavy-Duty Platform Trolley 500 kg",
            description: "",
            quantity: 2,
            unitPricePaise: 629900,
            lineTotalPaise: 1259800,
            gstRate: "18.00",
            lineTaxPaise: 226764,
            hsn: "87168010",
          },
        ],
        cartage: {
          name: "Cartage - delivery charge",
          description: "",
          chargePaise: 45000,
          sac: null,
          gstRate: "18.00",
          taxPaise: 8100,
        },
        totals: {
          treatment: "gst",
          subtotalPaise: 1304800,
          deliveryPaise: 45000,
          deliveryTaxPaise: 8100,
          taxablePaise: 1259800,
          cgstPaise: 117432,
          sgstPaise: 117432,
          igstPaise: 0,
          grandTotalPaise: 1539664,
        },
      }),
    );
    expect(q.totals.totalTaxPaise).toBe(226764 + 8100);
  });

  it("builds a non-GST quotation with zero tax", () => {
    const q = buildQuotationData(
      refInput({
        customer: { name: "Jane", phone: "+919820002222", email: null, gstin: null },
        billing: {
          name: null, addressLine: null, city: null,
          state: null, stateCode: null, pincode: null,
        },
        items: [
          {
            name: "Trolley", description: "", quantity: 1,
            unitPricePaise: 10000, lineTotalPaise: 10000,
            gstRate: null, lineTaxPaise: 0, hsn: null,
          },
        ],
        cartage: {
          name: "Cartage - delivery charge", description: "",
          chargePaise: 5000, sac: null, gstRate: null, taxPaise: 0,
        },
        totals: {
          treatment: "non_gst", subtotalPaise: 15000, deliveryPaise: 5000,
          deliveryTaxPaise: 0, taxablePaise: 10000,
          cgstPaise: 0, sgstPaise: 0, igstPaise: 0, grandTotalPaise: 15000,
        },
      }),
    );
    expect(q.treatment).toBe("non_gst");
    expect(q.totals.totalTaxPaise).toBe(0);
  });

  it("builds a B2C GST quotation without a customer GSTIN", () => {
    // Every real order is tax_treatment=gst with no GSTIN — the guard
    // must not refuse the normal B2C supply (mirror of invoices/data.ts).
    const q = buildQuotationData(
      refInput({
        customer: { name: "Jane", phone: "+919820002222", email: null, gstin: null },
      }),
    );
    expect(q.treatment).toBe("gst");
    expect(q.customer.gstin).toBeNull();
    expect(q.totals.igstPaise).toBe(33710);
  });

  it("refuses corrupt snapshots instead of rendering wrong totals", () => {
    expect(() =>
      buildQuotationData(
        refInput({ totals: { ...refInput().totals, grandTotalPaise: 1 } }),
      ),
    ).toThrow(/grand total/);
    expect(() =>
      buildQuotationData(
        refInput({
          totals: { ...refInput().totals, igstPaise: 1, cgstPaise: 33709 },
        }),
      ),
    ).toThrow(/mixes intra-state/);
    expect(() =>
      buildQuotationData(refInput({ validTill: "2026-10-01" })),
    ).toThrow(/validity/);
    expect(() =>
      buildQuotationData(refInput({ quotationNumber: "INV/FY26-27/000042" })),
    ).toThrow(/quotation number/);
    expect(() =>
      buildQuotationData(refInput({ terms: [] })),
    ).toThrow(/terms/);
  });
});

describe("quotation eligibility (provisional only)", () => {
  it.each(["draft", "pending_payment", "payment_submitted"])(
    "allows quotations for %s orders",
    (status) => {
      expect(canIssueQuotation(status)).toBe(true);
    },
  );

  it.each(["paid", "confirmed", "processing", "delivered", "cancelled", "refunded"])(
    "refuses quotations for %s orders",
    (status) => {
      expect(canIssueQuotation(status)).toBe(false);
    },
  );

  it("refuses non-provisional orders at build time", () => {
    expect(() => buildQuotationData(refInput({ orderStatus: "delivered" }))).toThrow(
      /provisional/,
    );
  });
});

describe("quotation numbering", () => {
  it("formats QTN-TS numbers with a 10-digit sequence", () => {
    expect(formatQuotationNumber(121264)).toBe("QTN-TS0000121264");
    expect(formatQuotationNumber(1)).toBe("QTN-TS0000000001");
    expect(() => formatQuotationNumber(0)).toThrow();
  });
});

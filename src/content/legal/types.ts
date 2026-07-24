export interface LegalSection {
  id: string;
  title: string;
  body: string;
}

export interface LegalDocument {
  title: string;
  version: string;
  effectiveDate: string;
  summary: string;
  sections: LegalSection[];
}

export interface RetentionPolicyDocument {
  processingHistoryDays: number;
  deletedAccountGraceDays: number;
  aiInputHandling: string;
  description: string;
  sections: LegalSection[];
}

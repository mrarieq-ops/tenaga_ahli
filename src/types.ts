export interface EvaluationResult {
  personnelName: string;
  proposedPosition: string;
  overallScore: number;
  educationAssessment: {
    no: number;
    kakRequirement: string;
    offeredEducation: string;
    score: number;
    weight: number;
    finalScore: number;
    aiRemark: string;
  };
  otherSubAssessment: {
    no: number;
    description: string;
    evaluation: string;
    score: number;
    weight: number;
    finalScore: number;
    aiRemark: string;
  };
  statusAssessment: {
    no: number;
    taxProof: string;
    employmentStatus: string;
    score: number;
    weight: number;
    finalScore: number;
    aiRemark: string;
  };
  experienceAssessment: {
    no: number;
    startDate: string;
    endDate: string;
    months: number;
    scope: number;
    position: number;
    reference: number;
    total: number;
    aiRemark: string;
  }[];
  criteriaScores: {
    no: number;
    name: string;
    score: number;
    bobot: number;
    nilaiAkhir: number;
    justification: string;
  }[];
  summary: string;
  requiredExperience?: string;
}

export interface ExtractedExperience {
  no: number;
  packageName: string;
  startDate: string;
  endDate: string;
}

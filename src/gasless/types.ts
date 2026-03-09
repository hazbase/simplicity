export interface RelayerClientConfig {
  baseUrl: string;
  apiKey: string;
}

export interface RequestPsetInput {
  amount: number;
  toAddress: string;
  fromLabel: string;
}

export interface RequestPsetResult {
  psetId: string;
  psetBase64: string;
  summary: {
    assetId: string;
    amountSat: number;
    toAddress: string;
    userInput: {
      txid: string;
      vout: number;
      amountSat: number;
    };
    userChangeSat: number;
    maxFeeSat: number;
    expiresAt: string;
    summaryHash: string;
  };
}

export interface SubmitSignedPsetInput {
  psetId: string;
  signedPsetBase64: string;
}

export interface SubmitSignedPsetResult {
  txId: string;
  status: "BROADCASTED";
  summaryHash: string;
  broadcastAt: string;
}

export interface PsetStatusResult {
  psetId: string;
  status: string;
  summaryHash: string;
  expiresAt: string;
  txId: string | null;
}

export interface GaslessTransferInput {
  relayer?: import("./RelayerClient").RelayerClient;
  amount: number;
  toAddress: string;
  fromLabel: string;
  userWallet: string;
}

export interface GaslessTransferResult {
  request: RequestPsetResult;
  signedPsetBase64: string;
  submit: SubmitSignedPsetResult;
}

export interface RequestSimplicityExecutionInput {
  fromLabel: string;
  artifact: {
    compiled: {
      program: string;
      cmr: string;
      internalKey: string;
      contractAddress: string;
    };
    source: {
      simfPath?: string;
      templateVars?: Record<string, string | number>;
    };
    legacy?: {
      params?: {
        minHeight?: number;
      };
    };
    network?: string;
  };
  toAddress: string;
  sendAmount?: number;
  feeSat?: number;
}

export interface RequestSimplicityExecutionResult {
  requestId: string;
  psetBase64: string;
  summaryCanonicalJson: string;
  detailedSummary: {
    contract: {
      program: string;
      cmr: string;
      internalKey: string;
      contractAddress: string;
    };
    expectedReceiver: string;
    inputs: Array<{ txid: string | null; vout: number | null; sequence: number | null }>;
    outputs: Array<{
      n: number;
      amount: number | null;
      asset: string | null;
      scriptPubKeyHex: string | null;
      address: string | null;
      isFee: boolean;
    }>;
    fee: Record<string, number> | null;
    locktime: number;
  };
  summary: {
    toAddress: string;
    sendAmountSat: number;
    feeSat: number;
    summaryHash: string;
    expiresAt: string;
    contractInput: { txid: string; vout: number; amountSat: number };
    sponsorInput: { txid: string; vout: number; amountSat: number };
  };
}

export interface SubmitSimplicityExecutionInput {
  requestId: string;
  signedPsetBase64: string;
}

export interface SubmitSimplicityExecutionResult {
  txId: string;
  status: "BROADCASTED";
  summaryHash: string;
  broadcastAt: string;
  rawTxHex: string;
}

export interface SimplicityStatusResult {
  requestId: string;
  status: string;
  summaryHash: string;
  expiresAt: string;
  txId: string | null;
}

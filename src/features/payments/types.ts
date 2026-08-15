export type PaymentActionState = {
  success?: boolean;
  message?: string;
  authorizationUrl?: string;
  reference?: string;
  status?: string;
};

export const initialPaymentActionState: PaymentActionState = {};

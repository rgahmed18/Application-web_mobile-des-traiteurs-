'use client';

import { REGEXP_ONLY_DIGITS } from 'input-otp';

import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

interface OtpCodeInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Appelé dès que les 6 chiffres sont saisis (validation sans clic supplémentaire). */
  onComplete?: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}

/**
 * Code SMS à 6 chiffres. Toujours de gauche à droite, même en arabe (les codes se lisent
 * ainsi), et compatible avec le remplissage automatique du code reçu par SMS.
 */
export function OtpCodeInput({
  id,
  value,
  onChange,
  onBlur,
  onComplete,
  invalid,
  disabled,
}: OtpCodeInputProps) {
  return (
    <div dir="ltr" className="flex justify-center">
      <InputOTP
        id={id}
        maxLength={6}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        onComplete={onComplete}
        aria-invalid={invalid}
        disabled={disabled}
      >
        <InputOTPGroup>
          {Array.from({ length: 6 }, (_, index) => (
            <InputOTPSlot key={index} index={index} className="size-12 text-lg" />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}

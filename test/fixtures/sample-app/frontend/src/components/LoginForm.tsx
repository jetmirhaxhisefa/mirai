import { useState, type FormEvent } from 'react';

type Props = { onLogin: (email: string, password: string) => Promise<void> };

export function LoginForm({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onLogin(email, password);
    } catch {
      setError('Login failed. Check your email and password.');
    }
  }

  return (
    <form onSubmit={submit} aria-label="Log in" data-testid="login-form">
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit">Log in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

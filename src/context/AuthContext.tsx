import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, role?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    Promise.resolve(operation),
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}

function validateHyperfeedsDomain(email: string): Error | null {
  const cleanEmail = (email || '').trim().toLowerCase();
  const isExactAdmin = cleanEmail === 'admin@hyperfeeds.com';
  const isOfficialDomain = cleanEmail.endsWith('@hyperfeeds.co.zw') || cleanEmail.endsWith('@hyperfeedsnutrition.co.zw');
  if (!isExactAdmin && !isOfficialDomain) {
    return new Error('Access restricted: Only official @hyperfeeds.co.zw email addresses or admin@hyperfeeds.com are allowed.');
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    withTimeout(supabase.auth.getSession(), 8000, 'Session check timed out.')
      .then(({ data: { session: s } }) => {
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          void fetchProfile(s.user.id);
        } else {
          setLoading(false);
        }
      })
      .catch((error) => {
        console.warn('Unable to restore the saved session:', error);
        setSession(null);
        setUser(null);
        setProfile(null);
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        (async () => {
          await fetchProfile(s.user.id);
        })();
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    try {
      const { data } = await withTimeout(
        supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle(),
        8000,
        'Profile lookup timed out.'
      );
      setProfile(data);
    } catch (error) {
      console.warn('Unable to load the user profile:', error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    const domainError = validateHyperfeedsDomain(email);
    if (domainError) return { error: domainError };

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }

  async function signUp(email: string, password: string, fullName: string, role: string = 'operator') {
    const domainError = validateHyperfeedsDomain(email);
    if (domainError) return { error: domainError };

    const { data: authData, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role } },
    });

    if (error) return { error: error as Error | null };

    if (authData?.user) {
      try {
        // Upsert profile with selected role
        await supabase.from('profiles').upsert([
          {
            id: authData.user.id,
            email: email.trim().toLowerCase(),
            full_name: fullName,
            role: role as any,
            updated_at: new Date().toISOString(),
          }
        ]);

        // Find role_id in roles table
        const { data: roleRow } = await supabase
          .from('roles')
          .select('id')
          .eq('code', role)
          .maybeSingle();

        if (roleRow?.id) {
          await supabase.from('user_roles').upsert([
            {
              user_id: authData.user.id,
              role_id: roleRow.id,
            }
          ]);
        }
      } catch (err) {
        console.warn('Failed to assign user role on signup:', err);
      }
    }

    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

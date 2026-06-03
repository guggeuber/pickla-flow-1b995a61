-- Create customer_transactions table
CREATE TABLE public.customer_transactions (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    venue_id uuid NOT NULL REFERENCES public.venues(id),
    user_id uuid REFERENCES auth.users(id),
    player_profile_id uuid REFERENCES public.player_profiles(id),
    
    amount_inc_vat integer NOT NULL,
    vat_rate integer NOT NULL DEFAULT 6,
    vat_amount integer NOT NULL,
    amount_ex_vat integer NOT NULL,
    
    source text NOT NULL, -- e.g., 'stripe_checkout', 'stripe_invoice', 'zettle', 'manual', 'refund'
    source_id text, -- e.g., 'cs_test_...', 'in_123...'
    status text NOT NULL DEFAULT 'completed', -- 'completed', 'pending', 'refunded', 'failed'
    
    paid_at timestamp with time zone NOT NULL DEFAULT now(),
    
    -- Receipt fields
    receipt_url text,
    receipt_number text,
    is_friskvard boolean NOT NULL DEFAULT false,
    
    -- Fortnox fields
    fortnox_export_status text NOT NULL DEFAULT 'pending', -- 'pending', 'exported', 'failed'
    fortnox_export_id text,
    fortnox_exported_at timestamp with time zone,
    
    raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique index for source + source_id
CREATE UNIQUE INDEX idx_customer_transactions_source_source_id ON public.customer_transactions (source, source_id) WHERE source_id IS NOT NULL;

-- Indexes for performance
CREATE INDEX idx_customer_transactions_venue_id ON public.customer_transactions (venue_id);
CREATE INDEX idx_customer_transactions_user_id ON public.customer_transactions (user_id);
CREATE INDEX idx_customer_transactions_player_profile_id ON public.customer_transactions (player_profile_id);
CREATE INDEX idx_customer_transactions_paid_at ON public.customer_transactions (paid_at);
CREATE INDEX idx_customer_transactions_status ON public.customer_transactions (status);
CREATE INDEX idx_customer_transactions_fortnox_export_status ON public.customer_transactions (fortnox_export_status);

-- Enable RLS
ALTER TABLE public.customer_transactions ENABLE ROW LEVEL SECURITY;

-- Staff can read venue transactions
CREATE POLICY "Staff can view venue customer_transactions" ON public.customer_transactions
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM venue_staff
            WHERE venue_staff.user_id = auth.uid()
            AND venue_staff.venue_id = customer_transactions.venue_id
            AND venue_staff.role IN ('owner', 'admin', 'desk')
        )
    );

-- Users can read their own transactions
CREATE POLICY "Users can view own customer_transactions" ON public.customer_transactions
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.customer_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();

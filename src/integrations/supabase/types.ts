export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      bookings: {
        Row: {
          booked_by: string | null
          booking_ref: string | null
          created_at: string | null
          currency: string | null
          end_time: string
          id: string
          notes: string | null
          start_time: string
          status: Database["public"]["Enums"]["booking_status"] | null
          total_price: number | null
          updated_at: string | null
          user_id: string
          venue_court_id: string
          venue_id: string
        }
        Insert: {
          booked_by?: string | null
          booking_ref?: string | null
          created_at?: string | null
          currency?: string | null
          end_time: string
          id?: string
          notes?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["booking_status"] | null
          total_price?: number | null
          updated_at?: string | null
          user_id: string
          venue_court_id: string
          venue_id: string
        }
        Update: {
          booked_by?: string | null
          booking_ref?: string | null
          created_at?: string | null
          currency?: string | null
          end_time?: string
          id?: string
          notes?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["booking_status"] | null
          total_price?: number | null
          updated_at?: string | null
          user_id?: string
          venue_court_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_venue_court_id_fkey"
            columns: ["venue_court_id"]
            isOneToOne: false
            referencedRelation: "venue_courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      community_feed: {
        Row: {
          content: Json | null
          created_at: string
          event_id: string | null
          feed_type: string
          id: string
          player_profile_id: string | null
          title: string
          venue_id: string | null
        }
        Insert: {
          content?: Json | null
          created_at?: string
          event_id?: string | null
          feed_type: string
          id?: string
          player_profile_id?: string | null
          title: string
          venue_id?: string | null
        }
        Update: {
          content?: Json | null
          created_at?: string
          event_id?: string | null
          feed_type?: string
          id?: string
          player_profile_id?: string | null
          title?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_feed_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_feed_player_profile_id_fkey"
            columns: ["player_profile_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_feed_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      community_stories: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          image_url: string
          venue_id: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          image_url: string
          venue_id?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          image_url?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_stories_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      courts: {
        Row: {
          court_number: number
          created_at: string | null
          event_id: string
          id: string
          is_available: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          court_number: number
          created_at?: string | null
          event_id: string
          id?: string
          is_available?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          court_number?: number
          created_at?: string | null
          event_id?: string
          id?: string
          is_available?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_challenges: {
        Row: {
          challenged_crew_id: string
          challenger_crew_id: string
          completed_at: string | null
          created_at: string
          id: string
          message: string | null
          result: Json | null
          status: string
        }
        Insert: {
          challenged_crew_id: string
          challenger_crew_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          message?: string | null
          result?: Json | null
          status?: string
        }
        Update: {
          challenged_crew_id?: string
          challenger_crew_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          message?: string | null
          result?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_challenges_challenged_crew_id_fkey"
            columns: ["challenged_crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_challenges_challenger_crew_id_fkey"
            columns: ["challenger_crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_members: {
        Row: {
          crew_id: string
          id: string
          joined_at: string
          player_profile_id: string
          role: string
        }
        Insert: {
          crew_id: string
          id?: string
          joined_at?: string
          player_profile_id: string
          role?: string
        }
        Update: {
          crew_id?: string
          id?: string
          joined_at?: string
          player_profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_members_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_members_player_profile_id_fkey"
            columns: ["player_profile_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_session_signups: {
        Row: {
          crew_session_id: string
          id: string
          player_profile_id: string
          signed_up_at: string
          status: string
        }
        Insert: {
          crew_session_id: string
          id?: string
          player_profile_id: string
          signed_up_at?: string
          status?: string
        }
        Update: {
          crew_session_id?: string
          id?: string
          player_profile_id?: string
          signed_up_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_session_signups_crew_session_id_fkey"
            columns: ["crew_session_id"]
            isOneToOne: false
            referencedRelation: "crew_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_session_signups_player_profile_id_fkey"
            columns: ["player_profile_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_sessions: {
        Row: {
          booking_id: string | null
          created_at: string
          created_by: string
          crew_id: string
          description: string | null
          end_time: string
          id: string
          is_private: boolean
          max_participants: number | null
          session_date: string
          start_time: string
          status: string
          title: string
          updated_at: string
          venue_court_id: string | null
          venue_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          created_by: string
          crew_id: string
          description?: string | null
          end_time: string
          id?: string
          is_private?: boolean
          max_participants?: number | null
          session_date: string
          start_time: string
          status?: string
          title: string
          updated_at?: string
          venue_court_id?: string | null
          venue_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          created_by?: string
          crew_id?: string
          description?: string | null
          end_time?: string
          id?: string
          is_private?: boolean
          max_participants?: number | null
          session_date?: string
          start_time?: string
          status?: string
          title?: string
          updated_at?: string
          venue_court_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crew_sessions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_sessions_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_sessions_venue_court_id_fkey"
            columns: ["venue_court_id"]
            isOneToOne: false
            referencedRelation: "venue_courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_sessions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      crews: {
        Row: {
          badge_color: string | null
          badge_emoji: string | null
          created_at: string
          created_by: string
          crew_type: string
          description: string | null
          id: string
          max_members: number
          min_rating: number
          name: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          badge_color?: string | null
          badge_emoji?: string | null
          created_at?: string
          created_by: string
          crew_type?: string
          description?: string | null
          id?: string
          max_members?: number
          min_rating?: number
          name: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          badge_color?: string | null
          badge_emoji?: string | null
          created_at?: string
          created_by?: string
          crew_type?: string
          description?: string | null
          id?: string
          max_members?: number
          min_rating?: number
          name?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crews_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      day_passes: {
        Row: {
          created_at: string | null
          currency: string | null
          id: string
          price: number | null
          purchase_date: string
          sold_by: string | null
          status: Database["public"]["Enums"]["day_pass_status"] | null
          user_id: string
          valid_date: string
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          id?: string
          price?: number | null
          purchase_date?: string
          sold_by?: string | null
          status?: Database["public"]["Enums"]["day_pass_status"] | null
          user_id: string
          valid_date: string
          venue_id: string
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          id?: string
          price?: number | null
          purchase_date?: string
          sold_by?: string | null
          status?: Database["public"]["Enums"]["day_pass_status"] | null
          user_id?: string
          valid_date?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_passes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      event_checkins: {
        Row: {
          checked_in: boolean | null
          checked_in_at: string | null
          created_at: string | null
          event_id: string
          id: string
          player_id: string
          session_date: string
        }
        Insert: {
          checked_in?: boolean | null
          checked_in_at?: string | null
          created_at?: string | null
          event_id: string
          id?: string
          player_id: string
          session_date: string
        }
        Update: {
          checked_in?: boolean | null
          checked_in_at?: string | null
          created_at?: string | null
          event_id?: string
          id?: string
          player_id?: string
          session_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_checkins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_checkins_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      event_likes: {
        Row: {
          auth_user_id: string
          created_at: string | null
          event_id: string
          id: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string | null
          event_id: string
          id?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string | null
          event_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_likes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_offers: {
        Row: {
          created_at: string | null
          cta_label: string | null
          description: string | null
          display_on_player_info: boolean | null
          display_on_ticker: boolean | null
          event_id: string
          id: string
          image_url: string | null
          priority: number | null
          title: string
          updated_at: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          created_at?: string | null
          cta_label?: string | null
          description?: string | null
          display_on_player_info?: boolean | null
          display_on_ticker?: boolean | null
          event_id: string
          id?: string
          image_url?: string | null
          priority?: number | null
          title: string
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          created_at?: string | null
          cta_label?: string | null
          description?: string | null
          display_on_player_info?: boolean | null
          display_on_ticker?: boolean | null
          event_id?: string
          id?: string
          image_url?: string | null
          priority?: number | null
          title?: string
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_offers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_templates: {
        Row: {
          background_url: string | null
          best_of: number | null
          category: string
          competition_type: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          display_name: string | null
          entry_fee: number | null
          event_type: Database["public"]["Enums"]["event_type"]
          format: Database["public"]["Enums"]["event_format"]
          id: string
          is_active: boolean | null
          is_drop_in: boolean | null
          is_public: boolean | null
          logo_url: string | null
          match_duration_default: number | null
          name: string
          points_to_win: number | null
          primary_color: string | null
          registration_fields: Json
          scoring_format: string | null
          scoring_type: string | null
          secondary_color: string | null
          updated_at: string | null
          vat_rate: number | null
          whatsapp_url: string | null
          win_by_two: boolean | null
        }
        Insert: {
          background_url?: string | null
          best_of?: number | null
          category?: string
          competition_type?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          display_name?: string | null
          entry_fee?: number | null
          event_type: Database["public"]["Enums"]["event_type"]
          format: Database["public"]["Enums"]["event_format"]
          id?: string
          is_active?: boolean | null
          is_drop_in?: boolean | null
          is_public?: boolean | null
          logo_url?: string | null
          match_duration_default?: number | null
          name: string
          points_to_win?: number | null
          primary_color?: string | null
          registration_fields?: Json
          scoring_format?: string | null
          scoring_type?: string | null
          secondary_color?: string | null
          updated_at?: string | null
          vat_rate?: number | null
          whatsapp_url?: string | null
          win_by_two?: boolean | null
        }
        Update: {
          background_url?: string | null
          best_of?: number | null
          category?: string
          competition_type?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          display_name?: string | null
          entry_fee?: number | null
          event_type?: Database["public"]["Enums"]["event_type"]
          format?: Database["public"]["Enums"]["event_format"]
          id?: string
          is_active?: boolean | null
          is_drop_in?: boolean | null
          is_public?: boolean | null
          logo_url?: string | null
          match_duration_default?: number | null
          name?: string
          points_to_win?: number | null
          primary_color?: string | null
          registration_fields?: Json
          scoring_format?: string | null
          scoring_type?: string | null
          secondary_color?: string | null
          updated_at?: string | null
          vat_rate?: number | null
          whatsapp_url?: string | null
          win_by_two?: boolean | null
        }
        Relationships: []
      }
      events: {
        Row: {
          aspect_ratio: string | null
          background_url: string | null
          battle_config: Json | null
          best_of: number | null
          category: string
          competition_type: string | null
          created_at: string | null
          description: string | null
          display_name: string | null
          end_date: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          final_generated: boolean | null
          format: Database["public"]["Enums"]["event_format"]
          group_stage_completed: boolean | null
          id: string
          is_drop_in: boolean
          is_public: boolean | null
          logo_url: string | null
          match_duration_default: number | null
          name: string
          number_of_courts: number | null
          offer_description: string | null
          offer_show_on_player_info: boolean | null
          offer_show_on_ticker: boolean | null
          offer_title: string | null
          offer_valid_until: string | null
          player_info_general: string | null
          points_to_win: number | null
          primary_color: string | null
          registration_fields: Json
          scoring_format: string | null
          scoring_type: string | null
          secondary_color: string | null
          semifinals_generated: boolean | null
          show_on_sticker: boolean
          slug: string | null
          start_date: string | null
          status: string | null
          template_id: string | null
          third_place_enabled: boolean | null
          tournament_complete: boolean | null
          updated_at: string | null
          venue_id: string | null
          whatsapp_url: string | null
          win_by_two: boolean | null
          winner_team_id: string | null
        }
        Insert: {
          aspect_ratio?: string | null
          background_url?: string | null
          battle_config?: Json | null
          best_of?: number | null
          category?: string
          competition_type?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          end_date?: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          final_generated?: boolean | null
          format: Database["public"]["Enums"]["event_format"]
          group_stage_completed?: boolean | null
          id?: string
          is_drop_in?: boolean
          is_public?: boolean | null
          logo_url?: string | null
          match_duration_default?: number | null
          name: string
          number_of_courts?: number | null
          offer_description?: string | null
          offer_show_on_player_info?: boolean | null
          offer_show_on_ticker?: boolean | null
          offer_title?: string | null
          offer_valid_until?: string | null
          player_info_general?: string | null
          points_to_win?: number | null
          primary_color?: string | null
          registration_fields?: Json
          scoring_format?: string | null
          scoring_type?: string | null
          secondary_color?: string | null
          semifinals_generated?: boolean | null
          show_on_sticker?: boolean
          slug?: string | null
          start_date?: string | null
          status?: string | null
          template_id?: string | null
          third_place_enabled?: boolean | null
          tournament_complete?: boolean | null
          updated_at?: string | null
          venue_id?: string | null
          whatsapp_url?: string | null
          win_by_two?: boolean | null
          winner_team_id?: string | null
        }
        Update: {
          aspect_ratio?: string | null
          background_url?: string | null
          battle_config?: Json | null
          best_of?: number | null
          category?: string
          competition_type?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          end_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          final_generated?: boolean | null
          format?: Database["public"]["Enums"]["event_format"]
          group_stage_completed?: boolean | null
          id?: string
          is_drop_in?: boolean
          is_public?: boolean | null
          logo_url?: string | null
          match_duration_default?: number | null
          name?: string
          number_of_courts?: number | null
          offer_description?: string | null
          offer_show_on_player_info?: boolean | null
          offer_show_on_ticker?: boolean | null
          offer_title?: string | null
          offer_valid_until?: string | null
          player_info_general?: string | null
          points_to_win?: number | null
          primary_color?: string | null
          registration_fields?: Json
          scoring_format?: string | null
          scoring_type?: string | null
          secondary_color?: string | null
          semifinals_generated?: boolean | null
          show_on_sticker?: boolean
          slug?: string | null
          start_date?: string | null
          status?: string | null
          template_id?: string | null
          third_place_enabled?: boolean | null
          tournament_complete?: boolean | null
          updated_at?: string | null
          venue_id?: string | null
          whatsapp_url?: string | null
          win_by_two?: boolean | null
          winner_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "event_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_likes: {
        Row: {
          auth_user_id: string
          created_at: string
          feed_item_id: string
          id: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          feed_item_id: string
          id?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          feed_item_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_likes_feed_item_id_fkey"
            columns: ["feed_item_id"]
            isOneToOne: false
            referencedRelation: "community_feed"
            referencedColumns: ["id"]
          },
        ]
      }
      ladder_challenges: {
        Row: {
          challenged_entry_id: string
          challenger_entry_id: string
          challenger_player_id: string
          created_at: string | null
          event_id: string
          id: string
          message: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          challenged_entry_id: string
          challenger_entry_id: string
          challenger_player_id: string
          created_at?: string | null
          event_id: string
          id?: string
          message?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          challenged_entry_id?: string
          challenger_entry_id?: string
          challenger_player_id?: string
          created_at?: string | null
          event_id?: string
          id?: string
          message?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ladder_challenges_challenged_entry_id_fkey"
            columns: ["challenged_entry_id"]
            isOneToOne: false
            referencedRelation: "ladder_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_challenges_challenger_entry_id_fkey"
            columns: ["challenger_entry_id"]
            isOneToOne: false
            referencedRelation: "ladder_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_challenges_challenger_player_id_fkey"
            columns: ["challenger_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_challenges_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      ladder_entries: {
        Row: {
          absences: number | null
          created_at: string | null
          event_id: string
          id: string
          player_id: string | null
          position: number
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          absences?: number | null
          created_at?: string | null
          event_id: string
          id?: string
          player_id?: string | null
          position: number
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          absences?: number | null
          created_at?: string | null
          event_id?: string
          id?: string
          player_id?: string | null
          position?: number
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ladder_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_entries_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_entries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      ladder_matches: {
        Row: {
          challenged_entry_id: string
          challenged_position_before: number
          challenged_score: number | null
          challenger_entry_id: string
          challenger_position_before: number
          challenger_score: number | null
          created_at: string | null
          event_id: string
          id: string
          played_at: string | null
          status: string | null
          updated_at: string | null
          winner_entry_id: string | null
        }
        Insert: {
          challenged_entry_id: string
          challenged_position_before: number
          challenged_score?: number | null
          challenger_entry_id: string
          challenger_position_before: number
          challenger_score?: number | null
          created_at?: string | null
          event_id: string
          id?: string
          played_at?: string | null
          status?: string | null
          updated_at?: string | null
          winner_entry_id?: string | null
        }
        Update: {
          challenged_entry_id?: string
          challenged_position_before?: number
          challenged_score?: number | null
          challenger_entry_id?: string
          challenger_position_before?: number
          challenger_score?: number | null
          created_at?: string | null
          event_id?: string
          id?: string
          played_at?: string | null
          status?: string | null
          updated_at?: string | null
          winner_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ladder_matches_challenged_entry_id_fkey"
            columns: ["challenged_entry_id"]
            isOneToOne: false
            referencedRelation: "ladder_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_matches_challenger_entry_id_fkey"
            columns: ["challenger_entry_id"]
            isOneToOne: false
            referencedRelation: "ladder_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_matches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_matches_winner_entry_id_fkey"
            columns: ["winner_entry_id"]
            isOneToOne: false
            referencedRelation: "ladder_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          battle_id: string | null
          battle_round: number | null
          best_of_games: number | null
          court_id: string | null
          created_at: string | null
          event_id: string
          game_scores: Json | null
          id: string
          match_duration_minutes: number | null
          match_number: number
          match_scoring_type: string | null
          points_per_game: number | null
          round: number
          scheduled_time: string | null
          stage: Database["public"]["Enums"]["match_stage"] | null
          started_at: string | null
          status: Database["public"]["Enums"]["match_status"] | null
          team1_id: string | null
          team1_score: number | null
          team2_id: string | null
          team2_score: number | null
          updated_at: string | null
        }
        Insert: {
          battle_id?: string | null
          battle_round?: number | null
          best_of_games?: number | null
          court_id?: string | null
          created_at?: string | null
          event_id: string
          game_scores?: Json | null
          id?: string
          match_duration_minutes?: number | null
          match_number: number
          match_scoring_type?: string | null
          points_per_game?: number | null
          round: number
          scheduled_time?: string | null
          stage?: Database["public"]["Enums"]["match_stage"] | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["match_status"] | null
          team1_id?: string | null
          team1_score?: number | null
          team2_id?: string | null
          team2_score?: number | null
          updated_at?: string | null
        }
        Update: {
          battle_id?: string | null
          battle_round?: number | null
          best_of_games?: number | null
          court_id?: string | null
          created_at?: string | null
          event_id?: string
          game_scores?: Json | null
          id?: string
          match_duration_minutes?: number | null
          match_number?: number
          match_scoring_type?: string | null
          points_per_game?: number | null
          round?: number
          scheduled_time?: string | null
          stage?: Database["public"]["Enums"]["match_stage"] | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["match_status"] | null
          team1_id?: string | null
          team1_score?: number | null
          team2_id?: string | null
          team2_score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team1_id_fkey"
            columns: ["team1_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team2_id_fkey"
            columns: ["team2_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_tier_pricing: {
        Row: {
          created_at: string | null
          discount_percent: number | null
          fixed_price: number | null
          id: string
          label: string | null
          pricing_rule_id: string | null
          product_type: string
          tier_id: string
          vat_rate: number | null
        }
        Insert: {
          created_at?: string | null
          discount_percent?: number | null
          fixed_price?: number | null
          id?: string
          label?: string | null
          pricing_rule_id?: string | null
          product_type: string
          tier_id: string
          vat_rate?: number | null
        }
        Update: {
          created_at?: string | null
          discount_percent?: number | null
          fixed_price?: number | null
          id?: string
          label?: string | null
          pricing_rule_id?: string | null
          product_type?: string
          tier_id?: string
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_tier_pricing_pricing_rule_id_fkey"
            columns: ["pricing_rule_id"]
            isOneToOne: false
            referencedRelation: "pricing_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_tier_pricing_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_tiers: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          discount_percent: number | null
          id: string
          is_active: boolean | null
          monthly_price: number | null
          name: string
          sort_order: number | null
          updated_at: string | null
          venue_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          discount_percent?: number | null
          id?: string
          is_active?: boolean | null
          monthly_price?: number | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
          venue_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          discount_percent?: number | null
          id?: string
          is_active?: boolean | null
          monthly_price?: number | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_tiers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          assigned_by: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          notes: string | null
          starts_at: string
          status: string
          tier_id: string
          updated_at: string | null
          user_id: string
          venue_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          starts_at?: string
          status?: string
          tier_id: string
          updated_at?: string | null
          user_id: string
          venue_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          starts_at?: string
          status?: string
          tier_id?: string
          updated_at?: string | null
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      opening_hours: {
        Row: {
          close_time: string
          created_at: string | null
          day_of_week: number
          id: string
          is_closed: boolean | null
          open_time: string
          venue_id: string
        }
        Insert: {
          close_time: string
          created_at?: string | null
          day_of_week: number
          id?: string
          is_closed?: boolean | null
          open_time: string
          venue_id: string
        }
        Update: {
          close_time?: string
          created_at?: string | null
          day_of_week?: number
          id?: string
          is_closed?: boolean | null
          open_time?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opening_hours_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      player_profiles: {
        Row: {
          auth_user_id: string
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string | null
          id: string
          phone: string | null
          pickla_rating: number | null
          preferred_venue_id: string | null
          total_matches: number | null
          total_wins: number | null
          updated_at: string | null
        }
        Insert: {
          auth_user_id: string
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          phone?: string | null
          pickla_rating?: number | null
          preferred_venue_id?: string | null
          total_matches?: number | null
          total_wins?: number | null
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          phone?: string | null
          pickla_rating?: number | null
          preferred_venue_id?: string | null
          total_matches?: number | null
          total_wins?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_profiles_preferred_venue_id_fkey"
            columns: ["preferred_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          auth_user_id: string | null
          created_at: string | null
          email: string | null
          event_id: string
          id: string
          is_captain: boolean | null
          name: string
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string | null
          email?: string | null
          event_id: string
          id?: string
          is_captain?: boolean | null
          name: string
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string | null
          email?: string | null
          event_id?: string
          id?: string
          is_captain?: boolean | null
          name?: string
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "players_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          created_at: string | null
          currency: string | null
          days_of_week: number[] | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          price: number
          time_from: string | null
          time_to: string | null
          type: string
          updated_at: string | null
          valid_from: string | null
          valid_to: string | null
          vat_rate: number | null
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          days_of_week?: number[] | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          price: number
          time_from?: string | null
          time_to?: string | null
          type: string
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
          vat_rate?: number | null
          venue_id: string
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          days_of_week?: number[] | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          time_from?: string | null
          time_to?: string | null
          type?: string
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
          vat_rate?: number | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      season_standings: {
        Row: {
          created_at: string | null
          final_position: number | null
          id: string
          player_id: string
          rating_change: number | null
          season_id: string
          total_matches: number | null
          total_wins: number | null
        }
        Insert: {
          created_at?: string | null
          final_position?: number | null
          id?: string
          player_id: string
          rating_change?: number | null
          season_id: string
          total_matches?: number | null
          total_wins?: number | null
        }
        Update: {
          created_at?: string | null
          final_position?: number | null
          id?: string
          player_id?: string
          rating_change?: number | null
          season_id?: string
          total_matches?: number | null
          total_wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "season_standings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_standings_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string | null
          end_date: string
          event_id: string
          id: string
          name: string
          start_date: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          end_date: string
          event_id: string
          id?: string
          name: string
          start_date: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          end_date?: string
          event_id?: string
          id?: string
          name?: string
          start_date?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seasons_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      standings: {
        Row: {
          created_at: string | null
          draws: number | null
          event_id: string
          id: string
          losses: number | null
          points: number | null
          points_against: number | null
          points_for: number | null
          rank: number | null
          team_id: string
          updated_at: string | null
          wins: number | null
        }
        Insert: {
          created_at?: string | null
          draws?: number | null
          event_id: string
          id?: string
          losses?: number | null
          points?: number | null
          points_against?: number | null
          points_for?: number | null
          rank?: number | null
          team_id: string
          updated_at?: string | null
          wins?: number | null
        }
        Update: {
          created_at?: string | null
          draws?: number | null
          event_id?: string
          id?: string
          losses?: number | null
          points?: number | null
          points_against?: number | null
          points_for?: number | null
          rank?: number | null
          team_id?: string
          updated_at?: string | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "standings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string | null
          created_at: string | null
          event_id: string
          id: string
          logo_url: string | null
          name: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          event_id: string
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          event_id?: string
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      venue_checkins: {
        Row: {
          checked_in_at: string
          checked_in_by: string | null
          checked_out_at: string | null
          created_at: string | null
          entitlement_id: string | null
          entry_type: string
          id: string
          player_name: string | null
          player_phone: string | null
          session_date: string
          user_id: string | null
          venue_id: string
        }
        Insert: {
          checked_in_at?: string
          checked_in_by?: string | null
          checked_out_at?: string | null
          created_at?: string | null
          entitlement_id?: string | null
          entry_type?: string
          id?: string
          player_name?: string | null
          player_phone?: string | null
          session_date?: string
          user_id?: string | null
          venue_id: string
        }
        Update: {
          checked_in_at?: string
          checked_in_by?: string | null
          checked_out_at?: string | null
          created_at?: string | null
          entitlement_id?: string | null
          entry_type?: string
          id?: string
          player_name?: string | null
          player_phone?: string | null
          session_date?: string
          user_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_checkins_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_courts: {
        Row: {
          court_number: number
          court_type: string | null
          created_at: string | null
          hourly_rate: number | null
          id: string
          is_available: boolean | null
          name: string
          updated_at: string | null
          venue_id: string
        }
        Insert: {
          court_number: number
          court_type?: string | null
          created_at?: string | null
          hourly_rate?: number | null
          id?: string
          is_available?: boolean | null
          name: string
          updated_at?: string | null
          venue_id: string
        }
        Update: {
          court_number?: number
          court_type?: string | null
          created_at?: string | null
          hourly_rate?: number | null
          id?: string
          is_available?: boolean | null
          name?: string
          updated_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_courts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_event_categories: {
        Row: {
          category_key: string
          created_at: string | null
          display_name: string
          id: string
          logo_url: string | null
          updated_at: string | null
          venue_id: string
          whatsapp_url: string | null
        }
        Insert: {
          category_key: string
          created_at?: string | null
          display_name: string
          id?: string
          logo_url?: string | null
          updated_at?: string | null
          venue_id: string
          whatsapp_url?: string | null
        }
        Update: {
          category_key?: string
          created_at?: string | null
          display_name?: string
          id?: string
          logo_url?: string | null
          updated_at?: string | null
          venue_id?: string
          whatsapp_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venue_event_categories_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_links: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          member_count: string | null
          sort_order: number | null
          title: string
          updated_at: string | null
          url: string
          venue_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          member_count?: string | null
          sort_order?: number | null
          title: string
          updated_at?: string | null
          url: string
          venue_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          member_count?: string | null
          sort_order?: number | null
          title?: string
          updated_at?: string | null
          url?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_links_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_staff: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string | null
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_staff_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          email: string | null
          id: string
          is_public: boolean | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          name: string
          phone: string | null
          postal_code: string | null
          primary_color: string | null
          secondary_color: string | null
          slug: string
          status: Database["public"]["Enums"]["venue_status"] | null
          timezone: string | null
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          email?: string | null
          id?: string
          is_public?: boolean | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          name: string
          phone?: string | null
          postal_code?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          slug: string
          status?: Database["public"]["Enums"]["venue_status"] | null
          timezone?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          email?: string | null
          id?: string
          is_public?: boolean | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["venue_status"] | null
          timezone?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_player_profile_id: { Args: { _user_id: string }; Returns: string }
      get_venue_id_for_event: { Args: { _event_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_crew_leader: {
        Args: { _crew_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_venue_admin: {
        Args: { _user_id: string; _venue_id: string }
        Returns: boolean
      }
      is_venue_member: {
        Args: { _user_id: string; _venue_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "customer" | "desk_staff" | "venue_admin" | "super_admin"
      booking_status:
        | "pending"
        | "confirmed"
        | "cancelled"
        | "completed"
        | "no_show"
      day_pass_status: "active" | "expired" | "cancelled"
      event_format:
        | "round_robin"
        | "knockout"
        | "mini_cup_2h"
        | "team_vs_team"
        | "amerikano"
        | "ladder"
      event_type:
        | "tournament"
        | "team_competition"
        | "corporate_event"
        | "mini_cup"
      match_stage: "group" | "semifinal" | "final" | "third_place"
      match_status: "scheduled" | "in_progress" | "completed"
      venue_status: "active" | "inactive" | "coming_soon"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["customer", "desk_staff", "venue_admin", "super_admin"],
      booking_status: [
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "no_show",
      ],
      day_pass_status: ["active", "expired", "cancelled"],
      event_format: [
        "round_robin",
        "knockout",
        "mini_cup_2h",
        "team_vs_team",
        "amerikano",
        "ladder",
      ],
      event_type: [
        "tournament",
        "team_competition",
        "corporate_event",
        "mini_cup",
      ],
      match_stage: ["group", "semifinal", "final", "third_place"],
      match_status: ["scheduled", "in_progress", "completed"],
      venue_status: ["active", "inactive", "coming_soon"],
    },
  },
} as const

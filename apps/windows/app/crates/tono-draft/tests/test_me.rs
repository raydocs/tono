#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use tono_draft::Draft;

    #[derive(Clone, Debug, Default, PartialEq)]
    struct IVerge {
        enable_auto_launch: Option<bool>,
        enable_tun_mode: Option<bool>,
    }

    fn verge(enable_auto_launch: bool, enable_tun_mode: bool) -> IVerge {
        IVerge {
            enable_auto_launch: Some(enable_auto_launch),
            enable_tun_mode: Some(enable_tun_mode),
        }
    }

    #[test]
    fn test_draft_basic_flow() {
        let draft = Draft::new(verge(true, false));

        {
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(true));
            assert_eq!(data.enable_tun_mode, Some(false));
        }

        draft.edit_draft(|d| {
            d.enable_auto_launch = Some(false);
            d.enable_tun_mode = Some(true);
        });

        {
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(true));
            assert_eq!(data.enable_tun_mode, Some(false));
        }

        {
            let latest = draft.latest_arc();
            assert_eq!(latest.enable_auto_launch, Some(false));
            assert_eq!(latest.enable_tun_mode, Some(true));
        }

        draft.apply();

        {
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(false));
            assert_eq!(data.enable_tun_mode, Some(true));
        }

        // 新一轮草稿并修改
        draft.edit_draft(|d| {
            d.enable_auto_launch = Some(true);
        });
        {
            let latest = draft.latest_arc();
            assert_eq!(latest.enable_auto_launch, Some(true));
            assert_eq!(latest.enable_tun_mode, Some(true));
        }

        draft.discard();

        {
            draft.edit_draft(|d| {
                assert_eq!(d.enable_auto_launch, Some(false));
                d.enable_tun_mode = Some(false);
            });
            let data = draft.data_arc();
            assert_eq!(data.enable_auto_launch, Some(false));
            assert_eq!(data.enable_tun_mode, Some(true));
        }
    }

    #[test]
    fn test_arc_pointer_behavior_on_edit_and_apply() {
        let draft = Draft::new(verge(true, false));

        let committed = draft.data_arc();
        let latest = draft.latest_arc();
        assert!(Arc::ptr_eq(&committed, &latest));

        draft.edit_draft(|d| d.enable_tun_mode = Some(true));
        let committed_after_first_edit = draft.data_arc();
        let draft_after_first_edit = draft.latest_arc();
        assert!(!Arc::ptr_eq(&committed_after_first_edit, &draft_after_first_edit));
        let prev_draft_ptr = Arc::as_ptr(&draft_after_first_edit);
        draft.apply();
        let committed_after_apply = draft.data_arc();
        assert_eq!(Arc::as_ptr(&committed_after_apply), prev_draft_ptr);

        draft.edit_draft(|d| d.enable_auto_launch = Some(false));
        let latest1 = draft.latest_arc();
        let latest1_ptr = Arc::as_ptr(&latest1);
        drop(latest1);

        draft.edit_draft(|d| d.enable_tun_mode = Some(false));
        let latest2 = draft.latest_arc();
        let latest2_ptr = Arc::as_ptr(&latest2);

        assert_eq!(latest1_ptr, latest2_ptr, "Unique edit should not clone Arc");
        assert_eq!(latest2.enable_auto_launch, Some(false));
        assert_eq!(latest2.enable_tun_mode, Some(false));
    }

    #[test]
    fn test_discard_restores_latest_to_committed() {
        let draft = Draft::new(verge(false, false));

        draft.edit_draft(|d| d.enable_auto_launch = Some(true));
        let committed = draft.data_arc();
        let latest = draft.latest_arc();
        assert!(!Arc::ptr_eq(&committed, &latest));

        draft.discard();
        let committed2 = draft.data_arc();
        let latest2 = draft.latest_arc();
        assert!(Arc::ptr_eq(&committed2, &latest2));
        assert_eq!(latest2.enable_auto_launch, Some(false));
    }

    #[test]
    fn test_edit_draft_returns_closure_result() {
        let draft = Draft::new(IVerge::default());
        let ret = draft.edit_draft(|d| {
            d.enable_tun_mode = Some(true);
            123usize
        });
        assert_eq!(ret, 123);
        let latest = draft.latest_arc();
        assert_eq!(latest.enable_tun_mode, Some(true));
    }
}

mod transactions {
    use tono_draft::{Draft, DraftTransaction};

    fn begin<'a>(layers: Vec<&'a dyn tono_draft::DraftLayer>) -> DraftTransaction<'a> {
        DraftTransaction::begin(layers).expect("no other transaction should hold these layers")
    }

    #[test]
    fn committing_applies_every_layer() {
        let first = Draft::new(1_u8);
        let second = Draft::new("a".to_owned());

        let transaction = begin(vec![&first, &second]);
        first.edit_draft(|value| *value = 2);
        second.edit_draft(|value| *value = "b".to_owned());
        transaction.commit();

        assert_eq!(**first.data_arc(), 2);
        assert_eq!(**second.data_arc(), "b");
    }

    #[test]
    fn dropping_without_committing_rolls_every_layer_back() {
        let first = Draft::new(1_u8);
        let second = Draft::new("a".to_owned());

        {
            let _transaction = begin(vec![&first, &second]);
            first.edit_draft(|value| *value = 2);
            second.edit_draft(|value| *value = "b".to_owned());
        }

        assert_eq!(**first.data_arc(), 1);
        assert_eq!(**second.data_arc(), "a");
        assert_eq!(
            **first.latest_arc(),
            1,
            "the draft itself is gone, not just uncommitted"
        );
    }

    #[test]
    fn an_early_return_rolls_back_without_the_caller_saying_so() {
        fn attempt(draft: &Draft<u8>, succeed: bool) -> Result<(), &'static str> {
            let transaction = begin(vec![draft]);
            draft.edit_draft(|value| *value = 9);
            if !succeed {
                return Err("failed after editing");
            }
            transaction.commit();
            Ok(())
        }

        let draft = Draft::new(1_u8);
        assert!(attempt(&draft, false).is_err());
        assert_eq!(**draft.data_arc(), 1, "a failed attempt leaves nothing behind");

        assert!(attempt(&draft, true).is_ok());
        assert_eq!(**draft.data_arc(), 9);
    }

    #[test]
    fn a_partly_edited_transaction_still_rolls_back_whole() {
        // The layer nobody edited must not be left holding a stale draft either.
        let edited = Draft::new(1_u8);
        let untouched = Draft::new(5_u8);

        drop(begin(vec![&edited, &untouched]));
        edited.edit_draft(|value| *value = 2);

        {
            let _transaction = begin(vec![&edited, &untouched]);
        }

        assert_eq!(**edited.latest_arc(), 1, "the earlier stray draft is cleared too");
        assert_eq!(**untouched.latest_arc(), 5);
    }
}

mod transaction_exclusivity {
    use tono_draft::{Draft, DraftTransaction};

    #[test]
    fn a_second_transaction_over_a_claimed_layer_is_refused() {
        let draft = Draft::new(1_u8);
        let _held = DraftTransaction::begin(vec![&draft]).expect("the first claim should succeed");

        let refused = DraftTransaction::begin(vec![&draft]);

        assert!(refused.is_err(), "a layer may only be staged by one transaction");
    }

    #[test]
    fn a_refused_transaction_leaves_the_layers_it_did_claim_free() {
        // Claiming is all-or-nothing: a caller that failed on the third layer must not keep
        // the first two, or the next attempt would be refused for a transaction that no
        // longer exists.
        let first = Draft::new(1_u8);
        let second = Draft::new(2_u8);
        let _contended = DraftTransaction::begin(vec![&second]).expect("the first claim should succeed");

        assert!(DraftTransaction::begin(vec![&first, &second]).is_err());

        drop(DraftTransaction::begin(vec![&first]).expect("the layer that was rolled off must be free"));
    }

    #[test]
    fn a_layer_is_free_again_once_its_transaction_ends() {
        let draft = Draft::new(1_u8);

        drop(DraftTransaction::begin(vec![&draft]).expect("first"));
        let committed = DraftTransaction::begin(vec![&draft]).expect("free after a rollback");
        committed.commit();

        drop(DraftTransaction::begin(vec![&draft]).expect("free after a commit"));
    }

    #[test]
    fn an_overlapping_writer_can_no_longer_discard_a_staged_edit() {
        // The regression this pins. A holds a transaction across a slow side effect; B starts,
        // stages its own edit over the one draft slot, fails, and rolls back. Before layers
        // were claimed, B's rollback cleared the single draft, A's commit then found nothing to
        // apply and did nothing at all — while A's caller was told it had succeeded and A's own
        // side effect had already happened.
        let verge = Draft::new(String::from("committed"));

        let transaction_a = DraftTransaction::begin(vec![&verge]).expect("A claims the layer");
        verge.edit_draft(|value| *value = String::from("A-wants-this"));

        let transaction_b = DraftTransaction::begin(vec![&verge]);
        assert!(transaction_b.is_err(), "B must be refused rather than share the slot");

        transaction_a.commit();

        assert_eq!(
            **verge.data_arc(),
            "A-wants-this",
            "A's edit must survive an overlapping writer"
        );
    }
}

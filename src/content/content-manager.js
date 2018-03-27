import SortAction from '../actions/sort/sort.action';
import PaginationAction from '../actions/pagination/pagination.action';
import BaseControl from '../controls/base/controls/base.control';
import DeepLinksService from '../services/deep-links.service';
import StorageService from '../services/storage.service';
import FilterAction from '../actions/filter/filter.action';

/**
 * content manager
 */
class ContentManager{

    /**
     * apply controls on the content groups
     * @param {Object} settings
     * @param {Map} controls - controls split by data-group and data-name: [groupName, [BaseControlsGroup1, BaseControlsGroup2, ...]]
     * @param {Map} groups - [groupName, Array.<{root: HTMLElement, items: Array.<HTMLElement>] groups
     * @param {string=} groupName - optional group name; if group name is empty or not provided -> refresh all groups
     */
    static apply(settings, controls, groups, groupName = ''){

        if(!controls || !groups) return;

        //group structure is Array.<{root: HTMLElement, items: Array.<HTMLElement>}>
        for(let [cGroupName, groupValueArr] of groups){

            if((groupName && groupName === cGroupName) || !groupName){

                //get controls of this group;
                //received controls array [BaseControlsGroup1, BaseControlsGroup2, ...]
                const baseControlsGroups = controls.get(cGroupName);

                //collect sort, pagination and filter options from all controls with the same group name
                const options = ContentManager.collectControlsOptions(baseControlsGroups);

                //there can be more than one block of items with the same group name
                //each itemsBlock has structure: {root: HTMLElement, items: Array.<HTMLElement>}
                for(let itemsBlock of groupValueArr){

                    let itemsNumber = itemsBlock.items.length;

                    //hide all elements moving them to the document fragment
                    let fragment = ContentManager.getItemsFragment(itemsBlock.items);

                    if(options.sortOptions && options.sortOptions.length > 0) {

                        //sort the items of the group using sort options of all controls
                        SortAction.sort(itemsBlock.items, options.sortOptions);
                        fragment = ContentManager.getItemsFragment(itemsBlock.items);
                    }

                    let filtered = itemsBlock.items;

                    if(options.pathFilterOptions){

                        for(let pathFilterOption of options.pathFilterOptions){

                            filtered = FilterAction.pathFilter(filtered, pathFilterOption.path);
                            itemsNumber = filtered.length;
                            fragment = ContentManager.getItemsFragment(filtered);
                        }
                    }

                    if(options.rangeFilterOptions){

                        for(let rangeFilterOption of options.rangeFilterOptions){

                            filtered = FilterAction.rangeFilter(filtered,
                                rangeFilterOption.path,
                                rangeFilterOption.from,
                                rangeFilterOption.to,
                                rangeFilterOption.min,
                                rangeFilterOption.max);

                            itemsNumber = filtered.length;
                            fragment = ContentManager.getItemsFragment(filtered);
                        }
                    }

                    if(options.textFilterOptions){

                        for(let textFilterOption of options.textFilterOptions){

                            filtered = FilterAction.textFilter(
                                filtered,
                                textFilterOption.text,
                                textFilterOption.path,
                                textFilterOption.mode,
                                textFilterOption.ignoreRegex);

                            itemsNumber = filtered.length;
                            fragment = ContentManager.getItemsFragment(filtered);
                        }
                    }

                    if(options.paginationOptions){

                        const paginationAction = new PaginationAction(
                            options.paginationOptions.currentPage,
                            options.paginationOptions.itemsPerPage,
                            filtered.length
                        );

                        //setPaginationOptions applies all computed properties of PaginationAction class to the latest pagination control
                        if(baseControlsGroups.length > 0 && baseControlsGroups[baseControlsGroups.length - 1].setPaginationOptions){
                            baseControlsGroups[baseControlsGroups.length - 1].setPaginationOptions(paginationAction);
                        }

                        const paginatedItems = filtered.slice(paginationAction.start, paginationAction.end);
                        itemsNumber = paginatedItems.length;
                        fragment = ContentManager.getItemsFragment(paginatedItems);
                    }

                    //return to HTML only relevant items
                    itemsBlock.root.appendChild(fragment);

                    //dispatch the event with different data about state of controls and items
                    ContentManager.sendStateEvent(options, itemsNumber, baseControlsGroups);
                }

                //if one of controls has data-jump attribute -> jump to the specified CSS selector or to the top
                ContentManager.jump(baseControlsGroups);
            }

        }

        if(settings.deepLinking) {

            //update deep link if it's enabled
            ContentManager.updateDeepLink(ContentManager.getDeepLink(controls, groups), settings.hashStart);
        }
        else{
            if(settings.storage){

                //update storage if it's enabled
                StorageService.set(ContentManager.getDeepLink(controls, groups), settings.storage, settings.storageName, settings.cookiesExpiration);
            }
        }
    }

    /**
     * if one of controls has data-jump attribute -> jump to the specified CSS selector or to the top
     * data-jump="any CSS selector or 'top' keyword"
     * examples: data-jump="header"
     *           data-jump=".top-bar"
     *           data-jump="#main"
     *           data-jump="top"
     * @param {Array.<BaseControlsGroup>} baseControlsGroups - [BaseControlsGroup1, BaseControlsGroup2, ...]
     */
    static jump(baseControlsGroups){

        if(!baseControlsGroups || baseControlsGroups.length <= 0) return;

        //-1 means no scroll
        let top = -1;

        //if multiple control in the group have data-jump attribute -> select the upper one
        for(let group of baseControlsGroups) {

            const path = group.getJumpPath();

            if(!path) continue;

            //top is always the upper ))
            if(path === 'top'){
                top = 0;
                break;
            }

            const groupJumpEl = document.querySelector(path);

            if(!groupJumpEl) continue;

            const groupJumpElRect = groupJumpEl.getBoundingClientRect();

            //make sure element is not hidden or disconnected
            if (!groupJumpEl.width && !groupJumpEl.height && !groupJumpEl.getClientRects().length) continue;

            const clientTop = document.clientTop || document.body.clientTop || 0;

            if(top < 0){

                //select the first jump path as the default value
                top = groupJumpElRect.top + window.pageYOffset - clientTop;
            }
            else{
                if(groupJumpElRect.top + window.pageYOffset - clientTop < top){
                    top = groupJumpElRect.top + window.pageYOffset - clientTop;
                }
            }
        }

        if(top >= 0){
            window.scroll(0, top);
        }
    }

    /**
     * send jPList general event with different data about state of controls and items
     * @param {object} options
     * @param {number} itemsNumber
     * @param {BaseControlsGroup} baseControlsGroups
     */
    static sendStateEvent(options, itemsNumber, baseControlsGroups){

        if(!baseControlsGroups) return;

        const stateEvent = new CustomEvent('jplist.state');

        stateEvent.jplistState = {
            options: options,
            itemsNumber: itemsNumber
        };

        for(let baseControlsGroup of baseControlsGroups){

            for(let control of baseControlsGroup.controls){

                control.element.dispatchEvent(stateEvent);
            }
        }
    }

    /**
     * collect sort, pagination and filter options from all controls with the same group name
     * @param {Array.<BaseControlsGroup>} baseControlsGroups
     * @return {object} sort, pagination and filter objects
     */
    static collectControlsOptions(baseControlsGroups){

        const options = {

            //there can be multiple sort options
            sortOptions: [],

            //there should be only one pagination options object;
            //in case of multiple -> get the latest
            paginationOptions: null,

            //there can be multiple filter options
            textFilterOptions: [],
            pathFilterOptions: [],
            rangeFilterOptions: []
        };

        for(let baseControlsGroup of baseControlsGroups){

            //get sort options only from sort controls
            if(baseControlsGroup.getSortOptions) {

                //add base control group sort options
                options.sortOptions = options.sortOptions.concat(baseControlsGroup.getSortOptions());
            }

            //get text filter options only from text filter controls
            if(baseControlsGroup.getTextFilterOptions) {

                //add base control group sort options
                options.textFilterOptions = options.textFilterOptions.concat(baseControlsGroup.getTextFilterOptions());
            }

            //get path filter options only from text filter controls
            if(baseControlsGroup.getPathFilterOptions) {

                //add base control group sort options
                options.pathFilterOptions = options.pathFilterOptions.concat(baseControlsGroup.getPathFilterOptions());
            }

            //get range filter options only from range filter controls
            if(baseControlsGroup.getRangeFilterOptions) {

                //add base control group sort options
                options.rangeFilterOptions = options.rangeFilterOptions.concat(baseControlsGroup.getRangeFilterOptions());
            }

            if(baseControlsGroup.getPaginationOptions) {
                options.paginationOptions = baseControlsGroup.getPaginationOptions();
            }
        }

        return options;
    }

    /**
     * get document fragment with the specified items
     * @param {Array.<HTMLElement>} items
     * @return {DocumentFragment}
     */
    static getItemsFragment(items){

        const fragment = document.createDocumentFragment();

        for(let item of items){
            fragment.appendChild(item);
        }

        return fragment;
    }

    /**
     * update deep link -> replace it in URL
     * @param {string} deepLink
     * @param {string} hashStart
     */
    static updateDeepLink(deepLink, hashStart = '#'){

        let hashStr = deepLink.replace(hashStart, '').trim();

        if(hashStr === ''){
            hashStr = hashStart;
        }
        else{
            hashStr = hashStart + hashStr;
        }

        if(window.location.hash !== hashStr){

            const index = window.location.href.indexOf(hashStart);
            let href;

            if(index === -1){
                href = window.location.href + hashStr;
            }
            else{
                href = window.location.href.substring(0, index) + hashStr;
            }

            if('replaceState' in window.history){
                window.history.replaceState('', '', href);
            }
            else{
                window.location.replace(href);
            }
        }
    }

    /**
     * update deep link URL according to the current controls states
     * @return {string} deep link
     */
    static getDeepLink(controls, groups){

        let deeplink = [];

        //group structure is Array.<{root: HTMLElement, items: Array.<HTMLElement>}>
        for(let cGroupName of groups.keys()){

            //get controls of this group;
            //received controls array [BaseControlsGroup1, BaseControlsGroup2, ...]
            const baseControlsGroups = controls.get(cGroupName);

            const deepLinkParts = [];
            for(let baseControlsGroup of baseControlsGroups){

                const dl = baseControlsGroup.getDeepLink();

                if(dl){
                    deepLinkParts.push(dl);
                }
            }

            if(deepLinkParts.length > 0){
                deeplink.push('group=' + cGroupName);
                deeplink = deeplink.concat(deepLinkParts);
            }
        }

        return deeplink.join('&');
    }

    /**
     * find all groups of elements that should be sorted, filtered, etc.
     * each group defined by data-jplist-group attribute;
     * each element in the group defined by data-jplist-item attribute;
     * @param {HTMLCollection} groups
     * @return {Map} Map[groupName, Array.<{root: HTMLElement, items: Array.<HTMLElement>] groups
     */
    static findGroups(groups){

        const groupsMap = new Map();

        if(!groups){
            return groupsMap;
        }

        //get all items with data attribute data-jplist-group
        const groupElements = [...groups];

        for(let groupElement of groupElements){

            const groupName = groupElement.getAttribute('data-jplist-group');

            let groupValue = [];

            if(groupsMap.has(groupName)){
                groupValue = groupsMap.get(groupName);
            }

            groupValue.push({

                /**
                 * the root element of the group
                 */
                root: groupElement,

                /**
                 * all group elements
                 */
                items: [...groupElement.querySelectorAll('[data-jplist-item]')],

                /**
                 * this fragment used as a container for invisible items
                 */
                fragment: document.createDocumentFragment()
            });

            groupsMap.set(groupName, groupValue);
        }

        return groupsMap;
    }

    /**
     * find all controls defined on page by data-jplist-control attribute;
     * control classes should be registered in window.jplist.controlTypes before using this method:
     * window.jplist.controlTypes = new Map([
     *      ['hidden-sort', HiddenSortControl],
     *      ...
     * ]);
     * @param {HTMLElement} root
     * @return {Array.<BaseControl>}
     */
    static findControls(root){

        if(!root) return [];

        const controls = [];

        //find all control
        const elements = root.querySelectorAll('[data-jplist-control]');

        if(elements) {

            for(let element of elements){

                const controlType = element.getAttribute('data-jplist-control');

                if(!controlType) continue;

                const controlInstance = new BaseControl(element);
                controls.push(controlInstance);
            }
        }

        return controls;
    }

    /**
     * split control by their data-group property
     * @param {Array.<BaseControl>} controls
     * @return {Map} [[groupName, controls array], [...], ...]
     */
    static findControlGroups(controls){

        const map = new Map();

        if(controls) {

            for (let control of controls) {

                let arr = [];

                if (map.has(control.group)) {
                    arr = map.get(control.group);
                }

                arr.push(control);

                map.set(control.group, arr);
            }
        }

        return map;
    }

    /**
     * find controls with the same name
     * @param {object} settings
     * @param {Array.<BaseControl>} controls
     * @return {Map} [[name, BaseControlsGroup], [...]]
     */
    static findSameNameControls(settings, controls){

        const map = new Map();

        if(controls){

            let deepLinkParams = null;

            if(settings.deepLinking){
                deepLinkParams = DeepLinksService.getUrlParams(window.location.hash, settings.hashStart);
            }
            else{
                if(settings.storage){

                    const deepLinkSavedInStorage = StorageService.get(settings.storage, settings.storageName);
                    deepLinkParams = DeepLinksService.getUrlParams(deepLinkSavedInStorage, '');
                }
            }

            for(let control of controls){

                //control with not defined type should be ignored
                if(!control.type || !window.jplist.controlTypes.has(control.type)) continue;

                //check if data-type class defined in window.jplist.controlTypes;
                //it should be defined like this:
                //window.jplist.controlTypes = window.jplist.controlTypes || new Map([
                //    ['hidden-sort', HiddenSortControl],
                //    ...
                //]);
                const controlClass = window.jplist.controlTypes.get(control.type);

                if(controlClass){

                    let controlGroup = null;

                    if (map.has(control.name)) {
                        controlGroup = map.get(control.name);
                    }
                    else{
                        controlGroup = new controlClass(control.group, control.name, [], deepLinkParams);
                    }

                    controlGroup.addControl(control);

                    map.set(control.name, controlGroup);
                }
            }
        }

        return map;
    }

    /**
     * initialize controls and split them by group and name
     * @param {object} settings
     * @param {HTMLElement} root
     * @return {Map} [groupName, [BaseControlsGroup1, BaseControlsGroup2, ...]]
     */
    static splitByGroupAndName(settings, root){

        const res = new Map();

        if(!root) return res;

        //find all controls: received {Array.<BaseControl>}
        const controls = ContentManager.findControls(root);

        //split controls by their data-group attributes;
        //the received structure is map: [[groupName, controls array], [...], ...]
        const controlsByGroupNames = ContentManager.findControlGroups(controls);

        for(let [groupName, groupControls] of controlsByGroupNames){

            //received {Map} - [[name, BaseControlsGroup], [...]]
            const sameNameControls = ContentManager.findSameNameControls(settings, groupControls);

            let arr = [];

            for(let baseControlsGroup of sameNameControls.values()){
                arr.push(baseControlsGroup);
            }

            res.set(groupName, arr);
        }

        return res;
    }
}

export default ContentManager;
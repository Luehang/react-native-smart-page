import React, { PureComponent } from "react";
import {
    View,
    ViewPropTypes,
    InteractionManager,
    Dimensions
} from "react-native";
import PropTypes from "prop-types";
import Scrolling from "react-native-scrolling";
import { createResponder } from "react-native-easy-guesture-responder";
import SwipeRender from "react-native-swipe-render";

const MIN_FLING_VELOCITY = 0.5;

// Dimensions are only used initially.
// onLayout should handle orientation swap.
const { width, height } = Dimensions.get("window");

export default class SmartPage extends PureComponent {
    static propTypes = {
        ...View.propTypes,
        data: PropTypes.array,
        renderItem: PropTypes.func,
        children: PropTypes.node,
        index: PropTypes.number,
        loadMinimal: PropTypes.bool,
        loadMinimalSize: PropTypes.number,
        loadMinimalLoader: PropTypes.element,
        pageMargin: PropTypes.number,
        scrollViewStyle: ViewPropTypes
            ? ViewPropTypes.style
            : View.propTypes.style,
        scrollEnabled: PropTypes.bool,
        sensitiveScroll: PropTypes.bool,
        onPageSelected: PropTypes.func,
        onPageScrollStateChanged: PropTypes.func,
        onPageScroll: PropTypes.func,
        scrollViewProps: PropTypes.object,
    };

    static defaultProps = {
        data: [],
        index: 0,
        loadMinimal: true,
        loadMinimalSize: 2,
        pageMargin: 0,
        scrollEnabled: true,
        sensitiveScroll: true,
        scrollViewProps: {}
    };

    // Do not initialize to make onPageSelected(0) be dispatched
    currentPage = undefined;
    layoutChanged = false;
    activeGesture = false;
    gestureResponder = undefined;

    state = {
        width,
        height,
        currIndex: this.props.index
    };

    constructor (props) {
        super(props);

        this.onLayout = this.onLayout.bind(this);
        this.renderRow = this.renderRow.bind(this);
        this.onResponderGrant = this.onResponderGrant.bind(this);
        this.onResponderMove = this.onResponderMove.bind(this);
        this.onResponderRelease = this.onResponderRelease.bind(this);
        this.getItemLayout = this.getItemLayout.bind(this);

        this.scroller = this.createScrolling();

        // before mount
        this.gestureResponder = createResponder({
            onStartShouldSetResponder: (evt, gestureState) => true,
            onResponderGrant: this.onResponderGrant,
            onResponderMove: this.onResponderMove,
            onResponderRelease: this.onResponderRelease,
            onResponderTerminate: this.onResponderRelease
        });
    }

    createScrolling () {
        return new Scrolling(true, (dx, dy, scroller) => {
            if (dx === 0 && dy === 0 && scroller.isFinished()) {
                if (!this.activeGesture) {
                    this.onPageScrollStateChanged("idle");
                }
            } else {
                const curX = this.scroller.getCurrX();
                this._innerList &&
                    this._innerList.scrollTo({
                        x: curX,
                        animated: false
                    });

                let position = Math.floor(
                    curX / (this.state.width + this.props.pageMargin)
                );
                position = this.validPage(position);
                let offset = (curX - this.getScrollOffsetOfPage(position)) /
                    (this.state.width + this.props.pageMargin);
                let fraction =
                    (curX - this.getScrollOffsetOfPage(position) - this.props.pageMargin) /
                    this.state.width;
                if (fraction < 0) {
                    fraction = 0;
                }
                this.props.onPageScroll && this.props.onPageScroll({
                    position, offset, fraction
                });
            }
        });
    }

    componentDidMount () {
        // FlatList is set to render at index.
        // The scroller we use is not aware of this.
        // Let it know by simulating most of what happens in scrollToPage()
        this.onPageScrollStateChanged("settling");

        const page = this.validPage(this.props.index);
        this.onPageChanged(page);

        const finalX = this.getScrollOffsetOfPage(page);
        this.scroller.startScroll(
            this.scroller.getCurrX(),
            0,
            finalX - this.scroller.getCurrX(),
            0,
            0
        );

        requestAnimationFrame(() => {
            // this is here to work around a bug in FlatList
            this.scrollByOffset(1);
            this.scrollByOffset(-1);
        });
    }

    componentDidUpdate (prevProps) {
        if (this.layoutChanged) {
            this.layoutChanged = false;
            if (typeof this.currentPage === "number") {
                this.scrollToPage(this.currentPage, true);
            }
        } else {
            if (this.props.data.length > 0) {
                if (
                    this.currentPage + 1 >= this.props.data.length &&
                    this.props.data.length !== prevProps.data.length
                ) {
                    this.scrollToPage(this.props.data.length, true);
                }
            } else {
                if (
                    this.currentPage + 1 >= this.props.children.length &&
                    this.props.children.length !== prevProps.children.length
                ) {
                    this.scrollToPage(this.props.children.length, true);
                }
            }
        }
    }

    onLayout (e) {
        // eslint-disable-next-line no-shadow
        let { width, height } = e.nativeEvent.layout;
        let sizeChanged = this.state.width !== width ||
            this.state.height !== height;
        if (width && height && sizeChanged) {
            this.layoutChanged = true;
            this.setState({ width, height });
        }
    }

    onResponderGrant (evt, gestureState) {
        // this.scroller.forceFinished(true);
        this.activeGesture = true;
        this.onPageScrollStateChanged("dragging");
    }

    onResponderMove (evt, gestureState) {
        let dx = gestureState.moveX - gestureState.previousMoveX;
        this.scrollByOffset(dx);
    }

    onResponderRelease (evt, gestureState, disableSettle) {
        this.activeGesture = false;
        if (!disableSettle) {
            this.settlePage(gestureState.vx);
        }
    }

    onPageChanged (page) {
        if (this.currentPage !== page) {
            this.currentPage = page;
            this.props.onPageSelected && this.props.onPageSelected(page);
        }
    }

    onPageScrollStateChanged (state) {
        this.props.onPageScrollStateChanged &&
            this.props.onPageScrollStateChanged(state);
    }

    settlePage (vx) {
        const { sensitiveScroll } = this.props;
        const data = this.props.data.length > 0
            ? this.props.data
            : this.props.children;
        let newIndex = null;

        if (sensitiveScroll && vx < -MIN_FLING_VELOCITY) {
            if (this.currentPage < data.length - 1) {
                this.flingToPage(this.currentPage + 1, vx);
                newIndex = this.currentPage + 1;
            } else {
                this.flingToPage(data.length - 1, vx);
                newIndex = data.length - 1;
            }
        } else if (sensitiveScroll && vx > MIN_FLING_VELOCITY) {
            if (this.currentPage > 0) {
                this.flingToPage(this.currentPage - 1, vx);
                newIndex = this.currentPage + 1;
            } else {
                this.flingToPage(0, vx);
                newIndex = 0;
            }
        } else {
            let page = this.currentPage;
            let progress = (this.scroller.getCurrX() -
                this.getScrollOffsetOfPage(this.currentPage)) /
                this.state.width;
            if (progress > 1 / 3) {
                page += 1;
            } else if (progress < -1 / 3) {
                page -= 1;
            }
            page = Math.min(data.length - 1, page);
            page = Math.max(0, page);
            this.scrollToPage(page);
            newIndex = page;
        }
        this.setState({ currIndex: newIndex });
    }

    getScrollOffsetOfPage (page) {
        const data = this.props.data.length > 0
            ? this.props.data
            : this.props.children;
        return this.getItemLayout(data, page).offset;
    }

    flingToPage (page, velocityX) {
        this.onPageScrollStateChanged("settling");

        page = this.validPage(page);
        this.onPageChanged(page);

        velocityX *= -1000; // per sec
        const finalX = this.getScrollOffsetOfPage(page);
        this.scroller.fling(
            this.scroller.getCurrX(),
            0,
            velocityX,
            0,
            finalX,
            finalX,
            0,
            0
        );
    }

    scrollToPage (page, immediate) {
        this.onPageScrollStateChanged("settling");

        page = this.validPage(page);
        this.onPageChanged(page);

        const finalX = this.getScrollOffsetOfPage(page);
        if (immediate) {
            InteractionManager.runAfterInteractions(() => {
                this.scroller.startScroll(
                    this.scroller.getCurrX(),
                    0,
                    finalX - this.scroller.getCurrX(),
                    0,
                    0
                );
                this._innerList &&
                    this._innerList.scrollTo({
                        x: finalX,
                        animated: false
                    });
            });
        } else {
            this.scroller.startScroll(
                this.scroller.getCurrX(),
                0,
                finalX - this.scroller.getCurrX(),
                0,
                400
            );
        }
    }

    scrollByOffset (dx) {
        this.scroller.startScroll(this.scroller.getCurrX(), 0, -dx, 0, 0);
    }

    validPage (page) {
        const data = this.props.data.length > 0
            ? this.props.data
            : this.props.children;
        page = Math.min(
            data.length - 1,
            page
        );
        page = Math.max(0, page);
        return page;
    }

    getScrollOffsetFromCurrentPage () {
        return this.scroller.getCurrX() -
            this.getScrollOffsetOfPage(this.currentPage);
    }

    getItemLayout (data, index) {
        // this method is called "getItemLayout", but it is not actually used
        // as the "getItemLayout" function for the FlatList. We use it within
        // the code on this page though. The reason for this is that working
        // with "getItemLayout" for FlatList is buggy. You might end up with
        // unrendered / missing content. Therefore we work around it, as
        // described here
        return {
            length: this.state.width + this.props.pageMargin,
            offset: (this.state.width + this.props.pageMargin) * index,
            index
        };
    }

    keyExtractor (item, index) {
        return index.toString();
    }

    renderRow ({ item, index }) {
        // eslint-disable-next-line no-shadow
        const { width, height } = this.state;
        const layout = {
            width,
            height,
            position: "relative"
        };
        if (this.props.data.length > 0) {
            let page = this.props.renderItem({ item, index });

            const style = page.props.style ? [page.props.style, layout] : layout;

            if (this.props.pageMargin > 0 && index > 0) {
                let newProps = { ...page.props, ref: page.ref, style };
                const element = React.createElement(page.type, newProps);

                // Do not using margin style to implement pageMargin.
                // The ListView seems to calculate a
                // wrong width for children views with margin.
                return (
                    <View key={index.toString()}>
                        <View style={{
                            width: width + this.props.pageMargin,
                            height: height,
                            alignItems: "flex-end"
                        }}>
                            { element }
                        </View>
                    </View>
                );
            } else {
                let newProps = { ...page.props, key: index.toString(), ref: page.ref, style };
                const element = React.createElement(page.type, newProps);

                return element;
            }
        } else {
            if (this.props.pageMargin > 0 && index > 0) {
                return (
                    <View key={index.toString()}>
                        <View style={{
                            width: width + this.props.pageMargin,
                            height: height,
                            alignItems: "flex-end"
                        }}>
                            <View style={layout}>
                                { item }
                            </View>
                        </View>
                    </View>
                );
            } else {
                return (
                    <View key={index.toString()} style={layout}>
                        { item }
                    </View>
                );
            }
        }
    }

    render () {
        // eslint-disable-next-line no-shadow
        const { width, height } = this.state;
        const {
            loadMinimal, loadMinimalSize, loadMinimalLoader,
            scrollEnabled, style, scrollViewStyle
        } = this.props;
        const data = this.props.data.length > 0
            ? this.props.data
            : this.props.children;

        if (width && height) {
            let list = data;
            if (!list) {
                list = [];
            }
        }

        let gestureResponder = this.gestureResponder;
        if (!scrollEnabled || data.length <= 0) {
            gestureResponder = {};
        }

        return (
            <View
                {...this.props}
                style={[style, { flex: 1 }]}
                {...gestureResponder}>
                <SwipeRender
                    {...this.props.scrollViewProps}
                    // scrollEventThrottle={16}
                    loadMinimal={loadMinimal}
                    loadMinimalSize={loadMinimalSize}
                    loadMinimalLoader={loadMinimalLoader}
                    scrollViewStyle={scrollViewStyle}
                    refScrollView={(component) => (this._innerList = component)}
                    scrollEnabled={false}
                    data={data}
                    renderItem={this.renderRow}
                    onLayout={this.onLayout}
                    index={this.state.currIndex}
                    loop={false}
                />
            </View>
        );
    }
}
